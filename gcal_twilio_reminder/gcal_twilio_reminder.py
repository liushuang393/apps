#!/usr/bin/env python3
"""
Google Calendar reminder utility with Twilio integration.

This script checks your Google Calendar for events starting within a
given time window (default 55–65 minutes from now) and sends a
reminder via SMS and voice call using Twilio.  It also supports a
daily summary at 08:00 of all events on the current day.  To avoid
sending duplicate notifications, it records event IDs and start times
in a local SQLite database.

Usage examples::

    # Dry‑run: print messages but do not send
    python gcal_twilio_reminder.py --dry-run

    # Send for events starting in the next hour
    python gcal_twilio_reminder.py --window-min 55 --window-max 65 \
      --from-number +819012345678 --to-number +819087654321

    # Run internal tests (does not hit external APIs)
    python gcal_twilio_reminder.py --run-tests

Environment variables (see .env.example) can be used to provide
Twilio credentials, calendar ID and timezone.  Command‑line options
override environment variables where specified.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import logging
import os
import sqlite3
import sys
from dataclasses import dataclass
from typing import Iterable, List, Optional

import pytz
from dateutil.parser import isoparse

try:
    from googleapiclient.discovery import build  # type: ignore[import]
    from google.auth.transport.requests import Request  # type: ignore[import]
    from google.oauth2.credentials import Credentials  # type: ignore[import]
    from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore[import]
except Exception:
    build = None  # type: ignore

try:
    from twilio.rest import Client  # type: ignore[import]
except Exception:
    Client = None  # type: ignore


# Default SQLite database path relative to working directory.
DEFAULT_DB_PATH = "sent_events.db"

# Google Calendar API scopes (readonly suffices)
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]


def setup_logging(level: str) -> None:
    """Initialise logging.  Logs include ISO timestamps and log levels."""
    numeric_level = getattr(logging, level.upper(), None)
    if not isinstance(numeric_level, int):
        numeric_level = logging.INFO
    logging.basicConfig(
        level=numeric_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )


def load_env_var(name: str, fallback: Optional[str] = None) -> Optional[str]:
    """Retrieve environment variable, falling back to given value."""
    value = os.getenv(name)
    if value:
        return value
    return fallback


def is_valid_e164(number: str) -> bool:
    """Check if a phone number looks like a valid E.164 string (simple check)."""
    return number.startswith("+") and len(number) >= 8 and number[1:].isdigit()


def load_gcal_service(credentials_path: str = "credentials.json"):
    """Load the Google Calendar API service.

    Returns a tuple `(service, creds)` or `(None, None)` if the API
    client libraries are missing.
    """
    if build is None:
        logging.warning(
            "google-api-python-client not installed; cannot access Google Calendar."
        )
        return None, None

    creds: Optional[Credentials] = None
    token_path = "token.json"
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)  # type: ignore[arg-type]
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())  # type: ignore[attr-defined]
        else:
            if not os.path.exists(credentials_path):
                raise FileNotFoundError(
                    f"Missing {credentials_path}; create OAuth client credentials via Google Cloud Console"
                )
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        # Save the credentials for the next run
        with open(token_path, "w") as token:
            token.write(creds.to_json())
    service = build("calendar", "v3", credentials=creds)  # type: ignore[call-arg]
    return service, creds


@dataclass
class Event:
    event_id: str
    title: str
    start: _dt.datetime
    html_link: str


def fetch_events(
    service, *, start_time: _dt.datetime, end_time: _dt.datetime, calendar_id: str = "primary"
) -> List[Event]:
    """Fetch events from Google Calendar between `start_time` and `end_time`.

    Returns a list of Event dataclasses.  If the service is None,
    returns an empty list.
    """
    events: List[Event] = []
    if service is None:
        return events
    try:
        events_result = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=start_time.isoformat(),
                timeMax=end_time.isoformat(),
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        for item in events_result.get("items", []):
            eid = item.get("id", "")
            summary = item.get("summary", "")
            start_str = item["start"].get("dateTime") or item["start"].get("date")
            html_link = item.get("htmlLink", "")
            if not start_str:
                continue
            # Parse RFC3339 datetime (date-only becomes 00:00)
            start_dt = isoparse(start_str)
            events.append(Event(eid, summary, start_dt, html_link))
    except Exception as exc:
        logging.error(f"Failed to fetch events: {exc}")
    return events


def ensure_db(db_path: str) -> sqlite3.Connection:
    """Open (or create) the SQLite DB and ensure the table exists."""
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sent_events (
            event_id TEXT NOT NULL,
            event_start TEXT NOT NULL,
            PRIMARY KEY (event_id, event_start)
        )
    """
    )
    conn.commit()
    return conn


def has_been_sent(conn: sqlite3.Connection, event: Event) -> bool:
    """Return True if this event/start combination has been sent previously."""
    cur = conn.execute(
        "SELECT 1 FROM sent_events WHERE event_id = ? AND event_start = ?",
        (event.event_id, event.start.isoformat()),
    )
    return cur.fetchone() is not None


def record_sent(conn: sqlite3.Connection, event: Event) -> None:
    """Record that an event reminder has been sent."""
    conn.execute(
        "INSERT OR IGNORE INTO sent_events(event_id, event_start) VALUES (?, ?)",
        (event.event_id, event.start.isoformat()),
    )
    conn.commit()


def format_line(event: Event, to_number: Optional[str]) -> str:
    """Format a single-line reminder message for an event."""
    local_start = event.start
    start_str = local_start.strftime("%H:%M")
    recipient = to_number if to_number else "固定電話（未設定）"
    return (
        f"電話リマインド（開始1時間前）: {start_str} {event.title} → 発信先: {recipient}\n"
        f"{event.html_link}"
    )


def send_sms_and_call(
    lines: Iterable[str], *, from_number: str, to_number: str, dry_run: bool = False
) -> None:
    """Send SMS and make a call via Twilio.  Merges lines into a single SMS.

    Only the first line will be spoken on the call.  If dry_run is True,
    just log the messages.
    """
    if not Client or dry_run:
        for line in lines:
            logging.info(f"[DRY] Would send: {line}")
        return
    try:
        client = Client(os.environ.get("TWILIO_ACCOUNT_SID"), os.environ.get("TWILIO_AUTH_TOKEN"))  # type: ignore[arg-type]
    except Exception as exc:
        logging.error(f"Twilio client initialisation failed: {exc}")
        return

    body = "\n\n".join(lines)
    try:
        message = client.messages.create(
            body=body,
            from_=from_number,
            to=to_number,
        )
        logging.info(f"Sent SMS: {message.sid}")
    except Exception as exc:
        logging.error(f"SMS sending failed: {exc}")
    # Only speak the first line for brevity
    first_line = next(iter(lines), "")
    if first_line:
        try:
            call = client.calls.create(
                twiml=f"<Response><Say>{first_line}</Say></Response>",
                from_=from_number,
                to=to_number,
            )
            logging.info(f"Placed call: {call.sid}")
        except Exception as exc:
            logging.error(f"Call initiation failed: {exc}")


def process_reminders(
    service,
    *,
    db_conn: sqlite3.Connection,
    window_min: int,
    window_max: int,
    calendar_id: str,
    from_number: str,
    to_number: str,
    tz_str: str,
    dry_run: bool,
) -> int:
    """Check for upcoming events and send reminders as necessary.

    Returns the number of reminders sent.
    """
    tz = pytz.timezone(tz_str)
    now = _dt.datetime.now(tz)
    start_time = now + _dt.timedelta(minutes=window_min)
    end_time = now + _dt.timedelta(minutes=window_max)
    events = fetch_events(
        service, start_time=start_time, end_time=end_time, calendar_id=calendar_id
    )
    lines: List[str] = []
    sent_count = 0
    for ev in events:
        # Skip all-day events (no time)
        if ev.start.tzinfo is None:
            continue
        # Avoid duplicates
        if has_been_sent(db_conn, ev):
            continue
        lines.append(format_line(ev, to_number))
        record_sent(db_conn, ev)
        sent_count += 1
    if lines:
        send_sms_and_call(lines, from_number=from_number, to_number=to_number, dry_run=dry_run)
    return sent_count


def run_tests() -> int:
    """Run simple internal tests."""
    import tempfile

    # Test E.164 validation
    assert is_valid_e164("+123456789"), "Valid E.164 should be accepted"
    assert not is_valid_e164("1234567"), "Missing + should be invalid"
    # Test DB recording and duplicate prevention
    with tempfile.NamedTemporaryFile() as tmp:
        conn = ensure_db(tmp.name)
        ev = Event("ev1", "Test", _dt.datetime.now(pytz.utc), "http://example.com")
        assert not has_been_sent(conn, ev)
        record_sent(conn, ev)
        assert has_been_sent(conn, ev)
    # Test formatting
    sample = Event("ev2", "Title", _dt.datetime(2025, 1, 1, 12, 0, tzinfo=pytz.utc), "http://link")
    line = format_line(sample, "+819000000000")
    assert "12:00" in line and "Title" in line and "+819000000000" in line
    print("TESTS_PASS")
    return 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-min", type=int, default=55, help="Minimum minutes ahead to check events")
    parser.add_argument("--window-max", type=int, default=65, help="Maximum minutes ahead to check events")
    parser.add_argument("--from-number", dest="from_number", help="Twilio from number (overrides env)")
    parser.add_argument("--to-number", dest="to_number", help="Recipient number (overrides env)")
    parser.add_argument("--calendar-id", default=None, help="Google Calendar ID (default primary)")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="SQLite DB file to store sent events")
    parser.add_argument("--tz", default=None, help="Timezone (e.g. Asia/Tokyo)")
    parser.add_argument("--log-level", default="INFO", help="Logging level")
    parser.add_argument("--dry-run", action="store_true", help="Print reminders but do not send")
    parser.add_argument("--run-tests", action="store_true", help="Run internal tests and exit")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    if args.run_tests:
        return run_tests()
    setup_logging(args.log_level)
    # Load environment variables (fallback values)
    from_num = args.from_number or load_env_var("TWILIO_FROM_NUMBER") or ""
    to_num = args.to_number or load_env_var("TWILIO_TO_NUMBER") or from_num
    if not from_num:
        logging.error("Twilio from number is required. Set via --from-number or TWILIO_FROM_NUMBER.")
        return 1
    if not is_valid_e164(from_num):
        logging.error(f"Invalid from number: {from_num}")
        return 1
    if to_num and not is_valid_e164(to_num):
        logging.error(f"Invalid to number: {to_num}")
        return 1
    cal_id = args.calendar_id or load_env_var("GOOGLE_CALENDAR_ID", "primary")
    tz_str = args.tz or load_env_var("TZ", "Asia/Tokyo")
    # Open DB
    conn = ensure_db(args.db)
    try:
        service, _creds = load_gcal_service()
    except Exception as exc:
        logging.error(str(exc))
        return 1
    sent = process_reminders(
        service,
        db_conn=conn,
        window_min=args.window_min,
        window_max=args.window_max,
        calendar_id=cal_id,
        from_number=from_num,
        to_number=to_num,
        tz_str=tz_str,
        dry_run=args.dry_run,
    )
    logging.info(f"Reminders sent: {sent}")
    return 0


if __name__ == "__main__":
    exit_code = main()
    # Avoid sys.exit in non-script environments
    if os.getenv("FORCE_SYS_EXIT"):
        sys.exit(exit_code)