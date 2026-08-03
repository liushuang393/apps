package jp.co.softroad.liteflow.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

/**
 * 管理系だけを保護する。
 *
 * <p><b>保護しない</b>: {@code /actuator/**}（Prometheus が無認証でスクレイプする）、
 * {@code /api/flows/**}（変換の実行API。コーパスと42項目の検証が叩く）、
 * {@code /api/templates/**}、{@code /api/instance}。
 *
 * <p><b>保護する</b>: {@code /api/rules/**}（ルールの参照・発行・承認・ロールバック）と
 * {@code /admin/**}（管理画面）。
 *
 * <p>ここを「全部保護」に広げると、validator の42項目・corpus-run・demo-transform を
 * すべて書き換えることになる。範囲を広げるときは同時に3つのスクリプトと validator を直すこと。
 *
 * <p><b>CSRF は画面だけ有効。</b> {@code /api/**} は除外している（スクリプトと validator が
 * トークン無しで POST する）。画面側はトークンを cookie で受け取る —
 * 管理画面は素のHTML+JSであり、Thymeleaf は {@code templates/} が変換ルールJSONの置き場と
 * 衝突するため入れていないので、HTMLへ埋め込む手段が無いからである。
 * トークンの遅延生成も切っている（切らないと静的な {@code login.html} を GET しただけでは
 * cookie が書かれず、フォームログインが認証の前に 403 になる）。
 *
 * <p><b>権限の境界は3つある。</b> どれか1つでも欠けると境界にならない。
 * <ol>
 *   <li>発行（POST/PUT/DELETE）は {@code ADMIN} のみ</li>
 *   <li>承認・却下は {@code APPROVER} のみ</li>
 *   <li><b>申請者は自分の申請を承認できない</b>（{@code RuleGovernanceService} が判定）。
 *       これが無いと {@code APPROVER} だけを持つ利用者が「申請して自己承認」で
 *       {@code ADMIN} を持たずに任意の本文を発行できてしまい、上の1が無意味になる</li>
 * </ol>
 *
 * <p><b>本番用ではない。</b> 利用者はインメモリ、既定パスワードは平文、多要素認証も
 * ユーザー管理もスクリプトのサンドボックスも無い。PoC で「承認フローが機能するか」を
 * 見るための最小構成である。
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    public UserDetailsService userDetailsService(
            PasswordEncoder encoder,
            @Value("${admin.users.admin-password:admin123}") String adminPassword,
            @Value("${admin.users.approver-password:approver123}") String approverPassword,
            @Value("${admin.users.viewer-password:viewer123}") String viewerPassword) {
        UserDetails admin = User.withUsername("admin")
                .password(encoder.encode(adminPassword))
                .roles("ADMIN", "APPROVER", "VIEWER").build();
        UserDetails approver = User.withUsername("approver")
                .password(encoder.encode(approverPassword))
                .roles("APPROVER", "VIEWER").build();
        UserDetails viewer = User.withUsername("viewer")
                .password(encoder.encode(viewerPassword))
                .roles("VIEWER").build();
        return new InMemoryUserDetailsManager(admin, approver, viewer);
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        // CSRFトークンを cookie で払い出す。管理画面は素のHTML+JSであり
        // （Thymeleaf は templates/ が変換ルールJSONと衝突するため入れていない）、
        // トークンをHTMLへ埋め込む手段が無い。JSが読めるように HttpOnly を外す。
        //
        // さらに setCsrfRequestAttributeName(null) で「遅延生成」をやめる。
        // 既定ではトークンを実際に読むまで cookie が書かれないため、静的な login.html を
        // GET しただけではトークンが手に入らず、POST /admin/login が
        // 認証の前に CsrfFilter で 403 になる（＝画面からログインできない）。
        CsrfTokenRequestAttributeHandler csrfRequestHandler = new CsrfTokenRequestAttributeHandler();
        csrfRequestHandler.setCsrfRequestAttributeName(null);

        http
                // API はスクリプトと validator から叩くので CSRF を外す。画面（/admin/**）は有効のまま。
                // Spring Security 7 で AntPathRequestMatcher は削除されたため文字列版を使う。
                .csrf(csrf -> csrf
                        .ignoringRequestMatchers("/api/**")
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .csrfTokenRequestHandler(csrfRequestHandler))
                .authorizeHttpRequests(auth -> auth
                        // 監視と実行系は従来どおり無認証。ここを変えると42項目が落ちる。
                        .requestMatchers("/actuator/**", "/api/flows/**", "/api/templates/**",
                                "/api/instance").permitAll()
                        .requestMatchers("/admin/login.html", "/admin/style.css").permitAll()
                        // 承認・却下は APPROVER のみ。ロールを分けるだけでは足りず、
                        // 「申請者本人は承認できない」判定が RuleGovernanceService に要る
                        // （admin は APPROVER も持つため、ロールだけでは自己承認を防げない）。
                        .requestMatchers(HttpMethod.POST, "/api/rules/approvals/*/approve",
                                "/api/rules/approvals/*/reject").hasRole("APPROVER")
                        // 申請そのものは認証済みなら誰でも出せる（出すだけでは反映されない）。
                        .requestMatchers(HttpMethod.POST, "/api/rules/approvals").authenticated()
                        // 直接発行とロールバックは ADMIN のみ。
                        .requestMatchers(HttpMethod.POST, "/api/rules/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PUT, "/api/rules/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.DELETE, "/api/rules/**").hasRole("ADMIN")
                        // 参照は VIEWER 以上（＝認証済みなら誰でも）。
                        .requestMatchers(HttpMethod.GET, "/api/rules/**").authenticated()
                        .requestMatchers("/api/rules/**").authenticated()
                        .requestMatchers("/admin/**").authenticated()
                        .anyRequest().permitAll())
                .httpBasic(Customizer.withDefaults())
                .formLogin(form -> form
                        .loginPage("/admin/login.html")
                        .loginProcessingUrl("/admin/login")
                        .defaultSuccessUrl("/admin/index.html", true)
                        .failureUrl("/admin/login.html?error")
                        .permitAll())
                .logout(logout -> logout
                        .logoutUrl("/admin/logout")
                        .logoutSuccessUrl("/admin/login.html?logout")
                        .permitAll());
        return http.build();
    }
}
