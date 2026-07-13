# UTF-8 preamble for agent PowerShell sessions.
# Dot-source or paste the one-liner from encoding-utf8.mdc before printing Japanese.
chcp 65001 > $null
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
