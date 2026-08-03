package jp.co.softroad.liteflow.controller;

import com.yomahub.liteflow.publisher.exception.PublisherConfigurationException;
import com.yomahub.liteflow.publisher.exception.RuleValidationException;
import com.yomahub.liteflow.publisher.exception.VersionConflictException;
import jp.co.softroad.liteflow.governance.SeparationOfDutiesException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 意図的にこのパッケージへ限定している。限定しない {@code @RestControllerAdvice} は
 * actuator のエンドポイントも横取りしてしまい、catch-all の {@code Exception} ハンドラが
 * コンテントネゴシエーションの 406 を 500 に変えていた。その結果
 * {@code /actuator/prometheus} は {@code Accept: application/json} を送るクライアントすべてに
 * 500 を返していた。
 */
@RestControllerAdvice(basePackages = "jp.co.softroad.liteflow.controller")
public class ApiExceptionHandler {

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<Map<String, Object>> notAcceptable(HttpMediaTypeNotAcceptableException e) {
        return error(HttpStatus.NOT_ACCEPTABLE, e);
    }
    @ExceptionHandler(VersionConflictException.class)
    public ResponseEntity<Map<String, Object>> conflict(VersionConflictException e) {
        return error(HttpStatus.CONFLICT, e);
    }

    /** 職務分離の違反は 403。リクエストの形は正しく、その人が行ってよい操作ではない。 */
    @ExceptionHandler(SeparationOfDutiesException.class)
    public ResponseEntity<Map<String, Object>> forbidden(SeparationOfDutiesException e) {
        return error(HttpStatus.FORBIDDEN, e);
    }

    @ExceptionHandler({RuleValidationException.class, IllegalArgumentException.class})
    public ResponseEntity<Map<String, Object>> badRequest(Exception e) {
        return error(HttpStatus.BAD_REQUEST, e);
    }

    @ExceptionHandler(PublisherConfigurationException.class)
    public ResponseEntity<Map<String, Object>> configuration(Exception e) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, e);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> general(Exception e) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, e);
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, Exception e) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("exception", e.getClass().getName());
        body.put("message", e.getMessage());
        return ResponseEntity.status(status).body(body);
    }
}
