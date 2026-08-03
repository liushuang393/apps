package jp.co.softroad.liteflow.transform;

import java.util.ArrayList;
import java.util.List;

/** 生成ソースに対して実際に javac を起動した結果。 */
public class CompileOutcome {
    private boolean attempted;
    private boolean compilerAvailable;
    private boolean success;
    private String className;
    private String source;
    private final List<Diagnostic> diagnostics = new ArrayList<>();
    private String failureReason;

    public static class Diagnostic {
        private final String kind;
        private final long line;
        private final String message;

        public Diagnostic(String kind, long line, String message) {
            this.kind = kind;
            this.line = line;
            this.message = message;
        }

        public String getKind() {
            return kind;
        }

        public long getLine() {
            return line;
        }

        public String getMessage() {
            return message;
        }
    }

    public boolean isAttempted() {
        return attempted;
    }

    public void setAttempted(boolean attempted) {
        this.attempted = attempted;
    }

    public boolean isCompilerAvailable() {
        return compilerAvailable;
    }

    public void setCompilerAvailable(boolean compilerAvailable) {
        this.compilerAvailable = compilerAvailable;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getClassName() {
        return className;
    }

    public void setClassName(String className) {
        this.className = className;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public List<Diagnostic> getDiagnostics() {
        return diagnostics;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }

    public int getErrorCount() {
        return (int) diagnostics.stream().filter(d -> "ERROR".equals(d.getKind())).count();
    }
}
