package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.RuleEngine;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import jp.co.softroad.liteflow.transform.TemplateProfile;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * ルール表駆動の変換ノード。
 *
 * <p>変換の中身は<b>ここには無い</b>。{@link RuleEngine} にある。
 * このクラスは「文脈から入力を取り出し、エンジンを呼び、結果を文脈へ戻す」だけの
 * <b>adapter</b> である。ルールの意味を確かめたいテストは
 * {@code RuleEngine.apply(...)} を直接呼ぶこと — Spring も LiteFlow も起動せずに済み、
 * 1件あたり数ミリ秒で回る。
 *
 * <p>文形式はどこにもハードコードしない。認識パターンも出力テンプレートも版数付きの
 * {@link TemplateProfile} から来るため、別のCOBOL文に対応するのは設定変更である。
 * どのルールにもマッチしなかった行は未カバーとして計数し、黙って捨てることはない。
 */
@LiteflowComponent("transform")
public class TransformNode extends AbstractTraceNode {

    @Autowired
    private TemplateLibrary templateLibrary;

    @Override
    public void process() {
        mark("transform");

        MigrationContext context = getContextBean(MigrationContext.class);
        if (!context.hasSource()) {
            return;  // オーケストレーション専用チェーンはソースを渡さない。変換対象なし
        }

        // programs の要素はエンジンが変換結果を書き込む対象そのもの（段落方式）。
        RuleEngine.Result result = RuleEngine.apply(new RuleEngine.Request(
                resolveProfile(context),
                context.getTemplates(),
                context.getFacts(),
                context.getSourceLines(),
                context.getSourceFiles(),
                context.getPrograms()));

        result.generatedLines().forEach(context::emit);
        result.artifacts().forEach(context::putGeneratedArtifact);
        result.coverageByFile().forEach(context::putCoverageForFile);
        result.findings().forEach(context::addQualityGateFinding);
        context.setCoverage(result.coverage());
    }

    private TemplateProfile resolveProfile(MigrationContext context) {
        String name = context.getTemplateProfile();
        if (name == null || name.isBlank()) {
            return null;
        }
        return templateLibrary.require(name);
    }
}
