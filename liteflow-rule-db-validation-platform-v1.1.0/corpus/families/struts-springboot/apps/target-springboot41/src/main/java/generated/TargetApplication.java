package generated;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 変換先プロジェクトの起動クラス。
 *
 * <p>パッケージを {@code generated} にしてあるのは、コーパスが生成するコントローラと
 * フォームBeanをそのまま同じパッケージへ配置して起動できるようにするためである。
 * 生成物とゴールデンが同じ場所に置けるので、差分が一致していることの意味がはっきりする。
 */
@SpringBootApplication
public class TargetApplication {
    public static void main(String[] args) {
        SpringApplication.run(TargetApplication.class, args);
    }
}
