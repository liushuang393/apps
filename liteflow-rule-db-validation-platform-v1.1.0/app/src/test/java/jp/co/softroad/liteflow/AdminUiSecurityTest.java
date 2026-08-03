package jp.co.softroad.liteflow;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 管理画面が<b>ブラウザから</b>使えることを守る。
 *
 * <p>これまでの検証（validator の42項目・各スクリプト）はすべて HTTP Basic 認証で
 * {@code /api/rules/**} を叩いていた。そのため<b>フォームログインの経路は一度も
 * 通っていなかった</b>。CSRF の除外は {@code /api/**} だけなので、
 * {@code POST /admin/login} は認証の前に {@code CsrfFilter} が403で弾いており、
 * 画面からはログインできない状態だった。Basic 認証しか使わない検査では気づけない。
 *
 * <p>ここで同時に守っているもう1つのこと: <b>無認証・無トークンで通ってはいけないものは
 * 通らないまま</b>であること。CSRF を通すために保護を緩めていないかを見る。
 *
 * <p>JDK の {@link HttpClient} を素で使う。リダイレクトを追わず cookie も自分で運ぶので、
 * ブラウザが実際に踏む手順をそのまま再現できる（Boot 4 では {@code TestRestTemplate} が
 * 別モジュールへ移っており、依存を増やしたくないという理由もある）。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdminUiSecurityTest {

    @LocalServerPort
    private int port;

    private final HttpClient client = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private URI url(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    /** cookie名 → 値。ブラウザの cookie jar の代わり。 */
    private static Map<String, String> jarOf(HttpResponse<?> response) {
        Map<String, String> jar = new LinkedHashMap<>();
        for (String header : response.headers().allValues("set-cookie")) {
            String pair = header.split(";", 2)[0];
            int eq = pair.indexOf('=');
            if (eq > 0) {
                jar.put(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
        return jar;
    }

    private static String cookieHeader(Map<String, String> jar) {
        List<String> parts = new ArrayList<>();
        jar.forEach((name, value) -> parts.add(name + "=" + value));
        return String.join("; ", parts);
    }

    private HttpResponse<String> get(String path, Map<String, String> jar, String basicAuth)
            throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(url(path)).GET();
        if (jar != null && !jar.isEmpty()) {
            builder.header("Cookie", cookieHeader(jar));
        }
        if (basicAuth != null) {
            builder.header("Authorization", "Basic " + Base64.getEncoder()
                    .encodeToString(basicAuth.getBytes(StandardCharsets.UTF_8)));
        }
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> postForm(String path, Map<String, String> form,
                                          Map<String, String> jar)
            throws IOException, InterruptedException {
        List<String> encoded = new ArrayList<>();
        form.forEach((key, value) -> encoded.add(
                java.net.URLEncoder.encode(key, StandardCharsets.UTF_8) + "="
                        + java.net.URLEncoder.encode(value, StandardCharsets.UTF_8)));
        HttpRequest.Builder builder = HttpRequest.newBuilder(url(path))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(String.join("&", encoded)));
        if (jar != null && !jar.isEmpty()) {
            builder.header("Cookie", cookieHeader(jar));
        }
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    /** ログイン画面を取得し、そこで払い出された cookie を返す。 */
    private Map<String, String> openLoginPage() throws IOException, InterruptedException {
        HttpResponse<String> page = get("/admin/login.html", null, null);
        assertEquals(200, page.statusCode(), "ログイン画面は無認証で見えること");
        return jarOf(page);
    }

    private Map<String, String> loginAsAdmin() throws IOException, InterruptedException {
        Map<String, String> jar = openLoginPage();
        Map<String, String> form = new LinkedHashMap<>();
        form.put("username", "admin");
        form.put("password", "admin123");
        form.put("_csrf", jar.get("XSRF-TOKEN"));
        HttpResponse<String> login = postForm("/admin/login", form, jar);
        assertEquals(302, login.statusCode(),
                () -> "フォームログインが 302 にならない: " + login.statusCode() + " / " + login.body());
        jar.putAll(jarOf(login));
        return jar;
    }

    // ---- フォームログインが通ること -----------------------------------------------

    @Test
    void loginPageHandsOutACsrfTokenCookie() throws Exception {
        Map<String, String> jar = openLoginPage();

        String token = jar.get("XSRF-TOKEN");
        assertNotNull(token, () -> "XSRF-TOKEN cookie が発行されていない。これが無いと素のHTMLは"
                + "トークンを送れない（Thymeleaf は設計上入れていない）。受け取った cookie: "
                + jar.keySet());
        assertTrue(token.length() > 8, () -> "トークンが短すぎる: " + token);
    }

    @Test
    void formLoginSucceedsFromABrowser() throws Exception {
        Map<String, String> jar = loginAsAdmin();

        assertTrue(jar.containsKey("JSESSIONID"), () -> "セッションが発行されていない: " + jar.keySet());
    }

    @Test
    void formLoginLandsOnTheRuleList() throws Exception {
        Map<String, String> jar = openLoginPage();
        Map<String, String> form = new LinkedHashMap<>();
        form.put("username", "admin");
        form.put("password", "admin123");
        form.put("_csrf", jar.get("XSRF-TOKEN"));

        HttpResponse<String> login = postForm("/admin/login", form, jar);

        assertEquals("/admin/index.html", URI.create(
                login.headers().firstValue("location").orElseThrow()).getPath(),
                "ログイン後の遷移先が違う");
    }

    @Test
    void formLoginWithoutACsrfTokenIsStillRejected() throws Exception {
        // CSRF を通すために保護を外していないこと。トークン無しは 403 のまま。
        Map<String, String> form = new LinkedHashMap<>();
        form.put("username", "admin");
        form.put("password", "admin123");

        HttpResponse<String> response = postForm("/admin/login", form, null);

        assertEquals(403, response.statusCode(),
                () -> "トークン無しのログインが通ってしまった: " + response.statusCode());
    }

    @Test
    void wrongPasswordGoesBackToTheLoginPageWithAnError() throws Exception {
        Map<String, String> jar = openLoginPage();
        Map<String, String> form = new LinkedHashMap<>();
        form.put("username", "admin");
        form.put("password", "まちがい");
        form.put("_csrf", jar.get("XSRF-TOKEN"));

        HttpResponse<String> response = postForm("/admin/login", form, jar);

        assertEquals(302, response.statusCode());
        assertTrue(response.headers().firstValue("location").orElse("")
                        .contains("/admin/login.html?error"),
                () -> "失敗時の遷移先が違う: " + response.headers().firstValue("location"));
    }

    @Test
    void logoutActuallyEndsTheSession() throws Exception {
        Map<String, String> jar = loginAsAdmin();

        // まずセッションが有効であることを確かめる。
        assertEquals(200, get("/api/rules", jar, null).statusCode(),
                "ログイン直後のセッションで参照できない");

        HttpResponse<String> logout = postForm("/admin/logout",
                Map.of("_csrf", jar.get("XSRF-TOKEN")), jar);
        // 204（HTMLを要求していないリクエストへの応答）と 302 のどちらも成功。
        // 403 だけが失敗であり、それが直そうとしている症状そのものである。
        assertTrue(logout.statusCode() / 100 == 2 || logout.statusCode() / 100 == 3,
                () -> "ログアウトが失敗している: " + logout.statusCode() + " / " + logout.body());

        HttpResponse<String> after = get("/api/rules", jar, null);
        assertTrue(after.statusCode() == 401 || after.statusCode() / 100 == 3,
                () -> "ログアウト後もセッションが生きている: " + after.statusCode());
    }

    // ---- 保護範囲を広げていないことの確認 -----------------------------------------

    @Test
    void unauthenticatedEndpointsStayUnauthenticated() throws Exception {
        // ここを保護すると validator の42項目・corpus-run・demo-transform が全部落ちる。
        assertEquals(200, get("/actuator/health", null, null).statusCode());
        assertEquals(200, get("/api/templates", null, null).statusCode());
        assertEquals(200, get("/api/instance", null, null).statusCode());
        assertEquals(200, get("/api/templates/diagnostics", null, null).statusCode());
    }

    @Test
    void ruleApiStillRequiresAuthenticationAndAcceptsBasicAuth() throws Exception {
        HttpResponse<String> anonymous = get("/api/rules", null, null);
        assertTrue(anonymous.statusCode() == 401 || anonymous.statusCode() / 100 == 3,
                () -> "無認証で参照できてしまった: " + anonymous.statusCode());

        // validator と各スクリプトが使っている経路。CSRF の変更で壊れていないこと。
        assertEquals(200, get("/api/rules", null, "viewer:viewer123").statusCode(),
                "Basic 認証での参照が壊れている");
    }

    @Test
    void writingRulesOverTheApiNeedsNoCsrfTokenAsBefore() throws Exception {
        // /api/** は CSRF 除外のまま。ここが変わると validator と3スクリプトを全部直すことになる。
        String body = "{\"chainId\":\"itCsrf" + port + "\",\"el\":\"THEN(validate,report)\","
                + "\"expectedVersion\":0}";
        HttpRequest request = HttpRequest.newBuilder(url("/api/rules/chains"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Basic " + Base64.getEncoder()
                        .encodeToString("admin:admin123".getBytes(StandardCharsets.UTF_8)))
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        assertTrue(response.statusCode() / 100 == 2,
                () -> "トークン無しのAPI発行が通らなくなっている: " + response.statusCode()
                        + " / " + response.body());
    }

    @Test
    void viewerStillCannotWriteRules() throws Exception {
        // RM-03 が守っている境界。CSRF の変更で緩んでいないこと。
        HttpRequest request = HttpRequest.newBuilder(url("/api/rules/chains"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Basic " + Base64.getEncoder()
                        .encodeToString("viewer:viewer123".getBytes(StandardCharsets.UTF_8)))
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"chainId\":\"itViewer" + port + "\",\"el\":\"THEN(validate)\","
                                + "\"expectedVersion\":0}", StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        assertEquals(403, response.statusCode(),
                () -> "viewer が発行できてしまった: " + response.statusCode() + " / " + response.body());
    }
}
