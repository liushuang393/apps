FROM maven:3.9.11-eclipse-temurin-17 AS build
ARG LITEFLOW_VERSION=2.16.1
ARG LITEFLOW_COMMIT=039d5cff0ca71d358db51413c10ed3177d74eb89
WORKDIR /workspace

# Prefer released Maven artifacts. If repository indexing/publication is delayed,
# build the exact official LiteFlow commit and install only the required modules.
# 下のビルド手順と同じキャッシュマウント。フォールバック分岐は LiteFlow モジュールを
# ローカルリポジトリへ install するため、それが `mvn verify` から見えている必要がある。
# ここにもマウントすることで3つの手順が同一リポジトリを共有する。
RUN --mount=type=cache,target=/root/.m2/repository set -eux; \
    if mvn -B -ntp dependency:get -Dartifact=com.yomahub:liteflow-spring-boot4-starter:${LITEFLOW_VERSION} \
       && mvn -B -ntp dependency:get -Dartifact=com.yomahub:liteflow-rule-db-sql:${LITEFLOW_VERSION}; then \
      printf '{"liteflowVersion":"%s","resolutionMode":"maven-central","sourceCommit":null}\n' "${LITEFLOW_VERSION}" > /tmp/build-metadata.json; \
    else \
      if ! command -v git >/dev/null 2>&1; then \
        apt-get update; \
        apt-get install -y --no-install-recommends git ca-certificates; \
        rm -rf /var/lib/apt/lists/*; \
      fi; \
      git init /tmp/liteflow-src; \
      cd /tmp/liteflow-src; \
      git remote add origin https://github.com/dromara/liteflow.git; \
      git fetch --depth 1 origin "${LITEFLOW_COMMIT}"; \
      git checkout --detach FETCH_HEAD; \
      test "$(git rev-parse HEAD)" = "${LITEFLOW_COMMIT}"; \
      mvn -B -ntp -DskipTests -Dmaven.javadoc.skip=true -Dgpg.skip=true \
        -pl :liteflow-spring-boot4-starter,:liteflow-rule-db-sql \
        -am install; \
      printf '{"liteflowVersion":"%s","resolutionMode":"official-source-build","sourceCommit":"%s"}\n' \
        "${LITEFLOW_VERSION}" "${LITEFLOW_COMMIT}" > /tmp/build-metadata.json; \
      cd /workspace; \
    fi

COPY pom.xml ./
# ローカルMavenリポジトリをビルド間でキャッシュする。これが無いと pom.xml を編集するたびに
# Spring Boot 4 + LiteFlow の依存ツリー全体を再ダウンロードすることになる。
RUN --mount=type=cache,target=/root/.m2/repository mvn -B -ntp -DskipTests dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2/repository mvn -B -ntp clean verify

# Struts→Spring Boot ファミリの生成Javaは Spring の型を参照するため、javac に
# Spring Boot 4.1 の依存jarを渡す必要がある。
#
# ここでの要点が2つある。
#  1. --mount=type=cache は**イメージ層に残らない**。生成コードの実行時クラスパスとして
#     使いたいので、copy-dependencies で実ディレクトリへ出してから COPY する。
#  2. アプリのビルドより**後**に置く。Boot 4.1 の解決に失敗しても、
#     すでに通っているアプリのビルドを巻き添えにしないため。
#
# 本検証基盤そのものは Spring Boot 4.0.6 で動く。4.1 は「変換先の題材」であり、
# app/pom.xml には決して足さないこと。
COPY boot41-classpath.pom.xml /tmp/boot41/pom.xml
RUN --mount=type=cache,target=/root/.m2/repository set -eux; \
    mkdir -p /workspace/boot41-libs; \
    if mvn -B -ntp -f /tmp/boot41/pom.xml dependency:copy-dependencies \
         -DoutputDirectory=/workspace/boot41-libs -DincludeScope=compile; then \
      echo "boot41 classpath ready: $(ls -1 /workspace/boot41-libs | wc -l) jar(s)"; \
    else \
      echo "WARNING: Spring Boot 4.1 dependency resolution failed; struts-springboot family will report a compile finding"; \
    fi

# JRE ではなく JDK を使う。CompileNode は ToolProvider.getSystemJavaCompiler() 経由で
# javac を実際に起動するが、JRE ではこれが null を返すためである。
FROM eclipse-temurin:17-jdk
WORKDIR /app
RUN mkdir -p /work/reports /app/test-reports
COPY --from=build /workspace/target/liteflow-rule-db-validation-app.jar /app/app.jar
COPY --from=build /workspace/target/surefire-reports/ /app/test-reports/
COPY --from=build /tmp/build-metadata.json /app/build-metadata.json
COPY --from=build /workspace/boot41-libs/ /app/boot41-libs/
ENV TRANSFORM_EXTRA_CLASSPATH=/app/boot41-libs
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
