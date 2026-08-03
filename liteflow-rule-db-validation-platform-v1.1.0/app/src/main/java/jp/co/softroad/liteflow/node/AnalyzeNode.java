package jp.co.softroad.liteflow.node;

import com.yomahub.liteflow.annotation.LiteflowComponent;
import jp.co.softroad.liteflow.model.MigrationContext;
import jp.co.softroad.liteflow.transform.SourceAnalyzer;
import jp.co.softroad.liteflow.transform.TemplateLibrary;
import jp.co.softroad.liteflow.transform.TemplateProfile;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 変換前の下ごしらえ。<b>2つのルール表（{@code structure} と {@code facts}）を評価する。</b>
 *
 * <p>解析の中身は<b>ここには無い</b>。{@link SourceAnalyzer} にある。
 * このクラスは文脈との受け渡しだけを行う <b>adapter</b> である。
 *
 * <p>どちらのルール表も持たないプロファイル（{@code compilable-v1} など）では何もしない。
 * 段落見出しが1つも見つからなかった場合もプログラムを積まない。
 * これにより既存の平坦な生成経路が完全にそのまま残る。
 */
@LiteflowComponent("analyze")
public class AnalyzeNode extends AbstractTraceNode {

    @Autowired
    private TemplateLibrary templateLibrary;

    @Override
    public void process() {
        mark("analyze");

        MigrationContext context = getContextBean(MigrationContext.class);
        if (!context.hasSource()) {
            return;
        }
        String profileName = context.getTemplateProfile();
        if (profileName == null || profileName.isBlank()) {
            return;
        }
        TemplateProfile profile = templateLibrary.require(profileName);

        SourceAnalyzer.Analysis analysis = SourceAnalyzer.analyse(profile,
                context.getSourceLines(), context.getSourceFiles());

        analysis.facts().forEach(context::putFact);
        analysis.programs().forEach(context::addProgram);
    }
}
