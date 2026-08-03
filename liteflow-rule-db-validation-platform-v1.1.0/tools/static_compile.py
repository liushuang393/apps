#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "app" / "src" / "main" / "java"
TEST = ROOT / "app" / "src" / "test" / "java"

STUBS = {
    'org\\springframework\\http\\HttpMethod.java': """
package org.springframework.http;
public enum HttpMethod { GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, TRACE }
""",
    'org\\springframework\\security\\config\\Customizer.java': """
package org.springframework.security.config;
public interface Customizer<T> {
  void customize(T t);
  static <T> Customizer<T> withDefaults() { return t -> { }; }
}
""",
    'org\\springframework\\security\\config\\annotation\\web\\builders\\HttpSecurity.java': """
package org.springframework.security.config.annotation.web.builders;
import org.springframework.security.config.Customizer;
import org.springframework.security.web.SecurityFilterChain;
public class HttpSecurity {
  public static class Registry {
    public Registry requestMatchers(String... patterns) { return this; }
    public Registry requestMatchers(org.springframework.http.HttpMethod method, String... patterns) { return this; }
    public Registry permitAll() { return this; }
    public Registry authenticated() { return this; }
    public Registry hasRole(String role) { return this; }
    public Registry anyRequest() { return this; }
  }
  public static class Csrf {
    public Csrf ignoringRequestMatchers(String... patterns) { return this; }
    public Csrf csrfTokenRepository(Object repository) { return this; }
    public Csrf csrfTokenRequestHandler(Object handler) { return this; }
  }
  public static class FormLogin {
    public FormLogin loginPage(String p) { return this; }
    public FormLogin loginProcessingUrl(String p) { return this; }
    public FormLogin defaultSuccessUrl(String p, boolean always) { return this; }
    public FormLogin failureUrl(String p) { return this; }
    public FormLogin permitAll() { return this; }
  }
  public static class Logout {
    public Logout logoutUrl(String p) { return this; }
    public Logout logoutSuccessUrl(String p) { return this; }
    public Logout permitAll() { return this; }
  }
  public HttpSecurity csrf(Customizer<Csrf> c) { return this; }
  public HttpSecurity authorizeHttpRequests(Customizer<Registry> c) { return this; }
  public HttpSecurity httpBasic(Customizer<Object> c) { return this; }
  public HttpSecurity formLogin(Customizer<FormLogin> c) { return this; }
  public HttpSecurity logout(Customizer<Logout> c) { return this; }
  public SecurityFilterChain build() { return null; }
}
""",
    'org\\springframework\\security\\config\\annotation\\web\\configuration\\EnableWebSecurity.java': """
package org.springframework.security.config.annotation.web.configuration;
public @interface EnableWebSecurity { }
""",
    'org\\springframework\\security\\web\\SecurityFilterChain.java': """
package org.springframework.security.web;
public interface SecurityFilterChain { }
""",
    'org\\springframework\\security\\core\\userdetails\\UserDetails.java': """
package org.springframework.security.core.userdetails;
public interface UserDetails { }
""",
    'org\\springframework\\security\\core\\userdetails\\UserDetailsService.java': """
package org.springframework.security.core.userdetails;
public interface UserDetailsService { }
""",
    'org\\springframework\\security\\core\\userdetails\\User.java': """
package org.springframework.security.core.userdetails;
public class User {
  public static class Builder {
    public Builder password(String p) { return this; }
    public Builder roles(String... roles) { return this; }
    public UserDetails build() { return null; }
  }
  public static Builder withUsername(String username) { return new Builder(); }
}
""",
    'org\\springframework\\security\\crypto\\password\\PasswordEncoder.java': """
package org.springframework.security.crypto.password;
public interface PasswordEncoder { String encode(CharSequence raw); }
""",
    'org\\springframework\\security\\crypto\\factory\\PasswordEncoderFactories.java': """
package org.springframework.security.crypto.factory;
import org.springframework.security.crypto.password.PasswordEncoder;
public final class PasswordEncoderFactories {
  public static PasswordEncoder createDelegatingPasswordEncoder() { return null; }
}
""",
    'org\\springframework\\security\\provisioning\\InMemoryUserDetailsManager.java': """
package org.springframework.security.provisioning;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
public class InMemoryUserDetailsManager implements UserDetailsService {
  public InMemoryUserDetailsManager(UserDetails... users) { }
}
""",
    'org\\springframework\\jdbc\\core\\JdbcTemplate.java': """
package org.springframework.jdbc.core;
import java.util.List;
public class JdbcTemplate {
  public <T> List<T> query(String sql, RowMapper<T> mapper, Object... args) { return null; }
  public int update(String sql, Object... args) { return 0; }
  public int update(PreparedStatementCreator creator, org.springframework.jdbc.support.KeyHolder keys) { return 0; }
  public <T> T queryForObject(String sql, Class<T> type, Object... args) { return null; }
}
""",
    'org\\springframework\\security\\web\\csrf\\CookieCsrfTokenRepository.java': """
package org.springframework.security.web.csrf;
public class CookieCsrfTokenRepository {
  public static CookieCsrfTokenRepository withHttpOnlyFalse() { return new CookieCsrfTokenRepository(); }
}
""",
    'org\\springframework\\security\\web\\csrf\\CsrfTokenRequestAttributeHandler.java': """
package org.springframework.security.web.csrf;
public class CsrfTokenRequestAttributeHandler {
  public void setCsrfRequestAttributeName(String name) { }
}
""",
    'org\\springframework\\jdbc\\support\\KeyHolder.java': """
package org.springframework.jdbc.support;
import java.util.List;
import java.util.Map;
public interface KeyHolder {
  Number getKey();
  List<Map<String, Object>> getKeyList();
}
""",
    'org\\springframework\\jdbc\\support\\GeneratedKeyHolder.java': """
package org.springframework.jdbc.support;
import java.util.List;
import java.util.Map;
public class GeneratedKeyHolder implements KeyHolder {
  public Number getKey() { return null; }
  public List<Map<String, Object>> getKeyList() { return null; }
}
""",
    'org\\springframework\\jdbc\\core\\PreparedStatementCreator.java': """
package org.springframework.jdbc.core;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
public interface PreparedStatementCreator {
  PreparedStatement createPreparedStatement(Connection con) throws SQLException;
}
""",
    'org\\springframework\\boot\\test\\web\\server\\LocalServerPort.java': """
package org.springframework.boot.test.web.server;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target({ElementType.FIELD, ElementType.METHOD})
public @interface LocalServerPort { }
""",
    'org\\springframework\\jdbc\\core\\RowMapper.java': """
package org.springframework.jdbc.core;
import java.sql.ResultSet;
import java.sql.SQLException;
public interface RowMapper<T> { T mapRow(ResultSet rs, int rowNum) throws SQLException; }
""",
    'org\\springframework\\stereotype\\Repository.java': """
package org.springframework.stereotype;
public @interface Repository { }
""",

    "com/yomahub/liteflow/annotation/LiteflowComponent.java": """
package com.yomahub.liteflow.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface LiteflowComponent { String value(); }
""",
    "com/yomahub/liteflow/core/NodeComponent.java": """
package com.yomahub.liteflow.core;
public abstract class NodeComponent {
  public abstract void process() throws Exception;
  protected <T> T getContextBean(Class<T> type) { return null; }
}
""",
    "com/yomahub/liteflow/core/FlowExecutor.java": """
package com.yomahub.liteflow.core;
import com.yomahub.liteflow.flow.LiteflowResponse;
public class FlowExecutor {
  public LiteflowResponse execute2Resp(String chainId, Object param, Object... contexts) { return null; }
}
""",
    "com/yomahub/liteflow/flow/LiteflowResponse.java": """
package com.yomahub.liteflow.flow;
public class LiteflowResponse {
  public boolean isSuccess() { return false; }
  public Throwable getCause() { return null; }
  public String getExecuteStepStr() { return null; }
}
""",
    "com/yomahub/liteflow/publisher/PublishChainRequest.java": """
package com.yomahub.liteflow.publisher;
public class PublishChainRequest {
  public static Builder builder() { return new Builder(); }
  public static class Builder {
    public Builder chainId(String value) { return this; }
    public Builder el(String value) { return this; }
    public Builder expectedVersion(Long value) { return this; }
    public PublishChainRequest build() { return new PublishChainRequest(); }
  }
}
""",
    "com/yomahub/liteflow/publisher/PublishResult.java": """
package com.yomahub.liteflow.publisher;
public class PublishResult {
  public long getVersion() { return 0L; }
  public long getSequence() { return 0L; }
  public Object getOperation() { return null; }
}
""",
    "com/yomahub/liteflow/publisher/PublishScriptRequest.java": """
package com.yomahub.liteflow.publisher;
import com.yomahub.liteflow.enums.NodeTypeEnum;
public class PublishScriptRequest {
  public static Builder builder() { return new Builder(); }
  public static class Builder {
    public Builder nodeId(String value) { return this; }
    public Builder script(String value) { return this; }
    public Builder name(String value) { return this; }
    public Builder type(String value) { return this; }
    public Builder type(NodeTypeEnum value) { return this; }
    public Builder language(String value) { return this; }
    public Builder expectedVersion(Long value) { return this; }
    public PublishScriptRequest build() { return new PublishScriptRequest(); }
  }
}
""",
    "com/yomahub/liteflow/enums/NodeTypeEnum.java": """
package com.yomahub.liteflow.enums;
public enum NodeTypeEnum {
  COMMON("common"), SCRIPT("script"), SWITCH_SCRIPT("switch_script"),
  BOOLEAN_SCRIPT("boolean_script"), FOR_SCRIPT("for_script");
  private final String code;
  NodeTypeEnum(String code) { this.code = code; }
  public String getCode() { return code; }
}
""",
    "com/yomahub/liteflow/publisher/RulePublisher.java": """
package com.yomahub.liteflow.publisher;
public interface RulePublisher extends AutoCloseable {
  PublishResult publishChain(PublishChainRequest request);
  PublishResult publishScript(PublishScriptRequest request);
  default void close() {}
}
""",
    "com/yomahub/liteflow/property/LiteflowConfig.java": """
package com.yomahub.liteflow.property;
public class LiteflowConfig {}
""",
    "com/yomahub/liteflow/metrics/LiteflowMetaView.java": """
package com.yomahub.liteflow.metrics;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.Map;
public class LiteflowMetaView {
  public LiteflowMetaView(MeterRegistry registry) {}
  public Map<String, Object> overview() { return null; }
  public List<Map<String, Object>> chains() { return null; }
  public Map<String, Object> chain(String id) { return null; }
  public List<Map<String, Object>> nodes() { return null; }
  public Map<String, Object> node(String id) { return null; }
  public Map<String, Object> ruleDb() { return null; }
  public Map<String, Object> error(String msg) { return null; }
}
""",
    "com/yomahub/liteflow/metrics/LiteflowMeterBinder.java": """
package com.yomahub.liteflow.metrics;
import com.yomahub.liteflow.property.LiteflowConfig;
public class LiteflowMeterBinder { public LiteflowMeterBinder(LiteflowConfig config) {} }
""",
    "com/yomahub/liteflow/metrics/ChainMetricsLifeCycle.java": """
package com.yomahub.liteflow.metrics;
import io.micrometer.core.instrument.MeterRegistry;
public class ChainMetricsLifeCycle { public ChainMetricsLifeCycle(MeterRegistry registry) {} }
""",
    "com/yomahub/liteflow/metrics/NodeMetricsLifeCycle.java": """
package com.yomahub.liteflow.metrics;
import io.micrometer.core.instrument.MeterRegistry;
public class NodeMetricsLifeCycle { public NodeMetricsLifeCycle(MeterRegistry registry) {} }
""",
    "io/micrometer/core/instrument/MeterRegistry.java": """
package io.micrometer.core.instrument;
public abstract class MeterRegistry {}
""",
    "com/yomahub/liteflow/publisher/RulePublisherFactory.java": """
package com.yomahub.liteflow.publisher;
import com.yomahub.liteflow.repository.sql.SqlPublisherConfig;
public final class RulePublisherFactory {
  public static RulePublisher create(SqlPublisherConfig config) { return null; }
}
""",
    "com/yomahub/liteflow/publisher/exception/PublisherConfigurationException.java": """
package com.yomahub.liteflow.publisher.exception;
public class PublisherConfigurationException extends RuntimeException { public PublisherConfigurationException() {} public PublisherConfigurationException(String m) { super(m); } }
""",
    "com/yomahub/liteflow/publisher/exception/RuleValidationException.java": """
package com.yomahub.liteflow.publisher.exception;
public class RuleValidationException extends RuntimeException { public RuleValidationException() {} public RuleValidationException(String m) { super(m); } }
""",
    "com/yomahub/liteflow/publisher/exception/VersionConflictException.java": """
package com.yomahub.liteflow.publisher.exception;
public class VersionConflictException extends RuntimeException { public VersionConflictException() {} public VersionConflictException(String m) { super(m); } }
""",
    "com/yomahub/liteflow/repository/RuleDbSyncManager.java": """
package com.yomahub.liteflow.repository;
public final class RuleDbSyncManager { public static void reconcileOnce() {} }
""",
    "com/yomahub/liteflow/repository/sql/SqlPublisherConfig.java": """
package com.yomahub.liteflow.repository.sql;
import javax.sql.DataSource;
public class SqlPublisherConfig {
  public static Builder builder() { return new Builder(); }
  public static class Builder {
    public Builder applicationName(String v) { return this; }
    public Builder dataSource(DataSource v) { return this; }
    public Builder url(String v) { return this; }
    public Builder username(String v) { return this; }
    public Builder password(String v) { return this; }
    public SqlPublisherConfig build() { return new SqlPublisherConfig(); }
  }
}
""",
    "jakarta/annotation/PreDestroy.java": """
package jakarta.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface PreDestroy {}
""",
    "org/springframework/boot/SpringApplication.java": """
package org.springframework.boot;
public final class SpringApplication { public static Object run(Class<?> type, String[] args) { return null; } }
""",
    "org/springframework/boot/autoconfigure/SpringBootApplication.java": """
package org.springframework.boot.autoconfigure;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface SpringBootApplication {}
""",
    "org/springframework/boot/test/context/SpringBootTest.java": """
package org.springframework.boot.test.context;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface SpringBootTest {
  WebEnvironment webEnvironment() default WebEnvironment.MOCK;
  enum WebEnvironment { MOCK, RANDOM_PORT, DEFINED_PORT, NONE }
}
""",
    "org/springframework/beans/factory/annotation/Autowired.java": """
package org.springframework.beans.factory.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target({ElementType.FIELD,ElementType.CONSTRUCTOR,ElementType.METHOD})
public @interface Autowired {}
""",
    "org/springframework/beans/factory/annotation/Value.java": """
package org.springframework.beans.factory.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target({ElementType.FIELD,ElementType.PARAMETER,ElementType.METHOD})
public @interface Value { String value(); }
""",
    "org/springframework/stereotype/Service.java": """
package org.springframework.stereotype;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface Service {}
""",
    "org/springframework/http/HttpStatus.java": """
package org.springframework.http;
public enum HttpStatus {
  CREATED(201,"Created"), CONFLICT(409,"Conflict"), BAD_REQUEST(400,"Bad Request"),
  FORBIDDEN(403,"Forbidden"),
  NOT_ACCEPTABLE(406,"Not Acceptable"), INTERNAL_SERVER_ERROR(500,"Internal Server Error");
  private final int value; private final String reason;
  HttpStatus(int value, String reason) { this.value=value; this.reason=reason; }
  public int value() { return value; }
  public String getReasonPhrase() { return reason; }
}
""",
    "org/springframework/http/ResponseEntity.java": """
package org.springframework.http;
public class ResponseEntity<T> {
  public static BodyBuilder status(HttpStatus status) { return new BodyBuilder(); }
  public static class BodyBuilder { public <T> ResponseEntity<T> body(T body) { return new ResponseEntity<T>(); } }
}
""",
    "org/springframework/web/bind/annotation/RestController.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface RestController {}
""",
    "org/springframework/web/bind/annotation/RestControllerAdvice.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface RestControllerAdvice { String[] basePackages() default {}; }
""",
    "org/springframework/web/HttpMediaTypeNotAcceptableException.java": """
package org.springframework.web;
public class HttpMediaTypeNotAcceptableException extends RuntimeException {
  public HttpMediaTypeNotAcceptableException() {}
  public HttpMediaTypeNotAcceptableException(String m) { super(m); }
}
""",
    "org/springframework/web/bind/annotation/RequestMapping.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target({ElementType.TYPE,ElementType.METHOD})
public @interface RequestMapping { String[] value() default {}; }
""",
    "org/springframework/web/bind/annotation/PostMapping.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface PostMapping { String[] value() default {}; }
""",
    "org/springframework/web/bind/annotation/GetMapping.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface GetMapping { String[] value() default {}; }
""",
    "org/springframework/web/bind/annotation/PathVariable.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.PARAMETER)
public @interface PathVariable { String value() default ""; }
""",
    "org/springframework/web/bind/annotation/RequestParam.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.PARAMETER)
public @interface RequestParam {
  String value() default "";
  String name() default "";
  boolean required() default true;
  String defaultValue() default "";
}
""",
    "com/fasterxml/jackson/annotation/JsonIgnore.java": """
package com.fasterxml.jackson.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target({ElementType.FIELD, ElementType.METHOD})
public @interface JsonIgnore { boolean value() default true; }
""",
    "com/fasterxml/jackson/annotation/JsonIgnoreProperties.java": """
package com.fasterxml.jackson.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface JsonIgnoreProperties { boolean ignoreUnknown() default false; }
""",
    "com/fasterxml/jackson/databind/DeserializationFeature.java": """
package com.fasterxml.jackson.databind;
public enum DeserializationFeature { FAIL_ON_UNKNOWN_PROPERTIES }
""",
    "com/fasterxml/jackson/databind/ObjectMapper.java": """
package com.fasterxml.jackson.databind;
import java.io.File;
import java.io.InputStream;
public class ObjectMapper {
  public ObjectMapper configure(DeserializationFeature f, boolean state) { return this; }
  public <T> T readValue(InputStream in, Class<T> type) { return null; }
  public <T> T readValue(String content, Class<T> type) throws java.io.IOException { return null; }
  public <T> T readValue(byte[] content, Class<T> type) throws java.io.IOException { return null; }
  public JsonNode readTree(InputStream in) throws java.io.IOException { return null; }
  public JsonNode readTree(String content) throws java.io.IOException { return null; }
  public JsonNode readTree(byte[] content) throws java.io.IOException { return null; }
  public JsonNode readTree(File file) throws java.io.IOException { return null; }
  public JsonNode createObjectNode() { return null; }
  public ObjectWriter writerWithDefaultPrettyPrinter() { return null; }
}
""",
    "com/fasterxml/jackson/databind/ObjectWriter.java": """
package com.fasterxml.jackson.databind;
public class ObjectWriter {
  public String writeValueAsString(Object value) throws java.io.IOException { return null; }
}
""",
    "com/fasterxml/jackson/databind/JsonNode.java": """
package com.fasterxml.jackson.databind;
import java.util.Iterator;
public abstract class JsonNode {
  public JsonNode get(String field) { return null; }
  public JsonNode get(int index) { return null; }
  public boolean hasNonNull(String field) { return false; }
  public boolean isObject() { return false; }
  public boolean isArray() { return false; }
  public int size() { return 0; }
  public String asText() { return null; }
  public double asDouble() { return 0d; }
  public Iterator<String> fieldNames() { return null; }
}
""",
    "org/slf4j/Logger.java": """
package org.slf4j;
public interface Logger {
  void info(String format, Object... args);
  void warn(String format, Object... args);
  void error(String format, Object... args);
}
""",
    "org/slf4j/LoggerFactory.java": """
package org.slf4j;
public final class LoggerFactory { public static Logger getLogger(Class<?> type) { return null; } }
""",
    "org/springframework/core/io/Resource.java": """
package org.springframework.core.io;
import java.io.IOException;
import java.io.InputStream;
public interface Resource {
  InputStream getInputStream() throws IOException;
  String getFilename();
}
""",
    "org/springframework/core/io/support/PathMatchingResourcePatternResolver.java": """
package org.springframework.core.io.support;
import org.springframework.core.io.Resource;
import java.io.IOException;
public class PathMatchingResourcePatternResolver {
  public Resource[] getResources(String pattern) throws IOException { return new Resource[0]; }
}
""",
    "org/springframework/context/annotation/Configuration.java": """
package org.springframework.context.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
public @interface Configuration { boolean proxyBeanMethods() default true; }
""",
    "org/springframework/context/annotation/Bean.java": """
package org.springframework.context.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface Bean { String[] value() default {}; }
""",
    "org/springframework/web/bind/annotation/RequestBody.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.PARAMETER)
public @interface RequestBody { boolean required() default true; }
""",
    "org/springframework/web/bind/annotation/ExceptionHandler.java": """
package org.springframework.web.bind.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface ExceptionHandler { Class<?>[] value() default {}; }
""",
    "org/junit/jupiter/api/Test.java": """
package org.junit.jupiter.api;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface Test {}
""",
    "org/junit/jupiter/api/BeforeEach.java": """
package org.junit.jupiter.api;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD)
public @interface BeforeEach {}
""",
    "org/junit/jupiter/api/Assumptions.java": """
package org.junit.jupiter.api;
public final class Assumptions {
  public static void assumeTrue(boolean condition) {}
  public static void assumeTrue(boolean condition, String message) {}
}
""",
    "org/junit/jupiter/api/function/Executable.java": """
package org.junit.jupiter.api.function;
@FunctionalInterface public interface Executable { void execute() throws Throwable; }
""",
    "org/junit/jupiter/api/Assertions.java": """
package org.junit.jupiter.api;
import org.junit.jupiter.api.function.Executable;
public final class Assertions {
  public static void assertTrue(boolean v) {}
  public static void assertTrue(boolean v, String message) {}
  public static void assertTrue(boolean v, java.util.function.Supplier<String> message) {}
  public static void assertFalse(boolean v) {}
  public static void assertFalse(boolean v, String message) {}
  public static void assertEquals(Object a, Object b) {}
  public static void assertEquals(Object a, Object b, String message) {}
  public static void assertEquals(Object a, Object b, java.util.function.Supplier<String> message) {}
  public static void assertEquals(long a, long b) {}
  public static void assertEquals(long a, long b, String message) {}
  public static void assertEquals(long a, long b, java.util.function.Supplier<String> message) {}
  public static void assertNotEquals(Object a, Object b) {}
  public static void assertNotEquals(Object a, Object b, String message) {}
  public static void assertNotNull(Object a) {}
  public static void assertNotNull(Object a, String message) {}
  public static void assertNotNull(Object a, java.util.function.Supplier<String> message) {}
  public static void assertFalse(boolean v, java.util.function.Supplier<String> message) {}
  public static void assertEquals(double a, double b, double delta) {}
  public static void assertEquals(double a, double b, double delta, String message) {}
  public static <T> T assertInstanceOf(Class<T> type, Object actual) { return null; }
  public static <T> T assertInstanceOf(Class<T> type, Object actual, String message) { return null; }
  public static <T extends Throwable> T assertThrows(Class<T> type, Executable e) { return null; }
}
""",
}


def main() -> int:
    javac = shutil.which("javac")
    if not javac:
        print("javac not found", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="liteflow-static-") as tmp:
        root = Path(tmp)
        stub_root = root / "stubs"
        out = root / "classes"
        for relative, content in STUBS.items():
            target = stub_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content.strip() + "\n", encoding="utf-8")
        sources = [str(p) for p in stub_root.rglob("*.java")]
        sources += [str(p) for p in MAIN.rglob("*.java")]
        sources += [str(p) for p in TEST.rglob("*.java")]
        out.mkdir()
        command = [javac, "--release", "17", "-encoding", "UTF-8", "-d", str(out), *sources]
        result = subprocess.run(command, text=True, capture_output=True)
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        if result.returncode != 0:
            return result.returncode
        class_count = sum(1 for _ in out.rglob("*.class"))
        print(f"STATIC_JAVA_COMPILE_PASS classes={class_count} sources={len(sources)}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
