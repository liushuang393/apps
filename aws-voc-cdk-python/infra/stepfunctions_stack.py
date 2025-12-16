# -*- coding: utf-8 -*-
# 目的: VOCパイプラインのStep Functions定義（エラーハンドリング強化版）
# 入力: S3イベント（EventBridge経由）
# 出力: NLP処理済みデータ（Parquet/JSON）
# 注意: リトライ/キャッチ/タイムアウト設定を含む
from aws_cdk import (Stack, Duration,
                     aws_stepfunctions as sfn,
                     aws_stepfunctions_tasks as tasks,
                     aws_events as events,
                     aws_events_targets as targets,
                     aws_sqs as sqs)
from constructs import Construct

class PipelineStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, buckets: dict, nlp_lambda, fetch_s3text, glue_job_name: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # 分岐: pipeline.mode = s3_direct | textract
        pipeline_mode = cfg['pipeline']['mode']

        # DLQ for failed executions
        dlq = sqs.Queue(self, 'VocPipelineDlq',
            queue_name=f"{cfg['project']['prefix']}-pipeline-dlq",
            retention_period=Duration.days(14),
            visibility_timeout=Duration.minutes(5)
        )

        # 失敗状態の定義
        failed_state = sfn.Fail(self, 'PipelineFailed',
            cause='パイプライン処理が失敗しました',
            error='PipelineExecutionError'
        )

        # s3_direct: まずオブジェクトをテキストとして取り出す（リトライ/キャッチ付き）
        fetch = tasks.LambdaInvoke(self, 'FetchS3Text',
            lambda_function=fetch_s3text,
            payload_response_only=True,
            retry_on_service_exceptions=True
        ).add_retry(
            errors=['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
            interval=Duration.seconds(2),
            max_attempts=3,
            backoff_rate=2.0
        ).add_catch(
            failed_state,
            errors=['States.ALL'],
            result_path='$.error'
        )

        # NLP Lambda（リトライ/キャッチ付き）
        nlp = tasks.LambdaInvoke(self, 'NlpLambda',
            lambda_function=nlp_lambda,
            payload_response_only=True,
            input_path='$.nlp_input',
            retry_on_service_exceptions=True
        ).add_retry(
            errors=['Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
            interval=Duration.seconds(2),
            max_attempts=3,
            backoff_rate=2.0
        ).add_catch(
            failed_state,
            errors=['States.ALL'],
            result_path='$.error'
        )

        # etl.mode が glue の場合は Glue Job を起動（JSON→Parquet変換、リトライ/キャッチ付き）
        glue_job = tasks.GlueStartJobRun(self, 'GlueJsonToParquet',
            glue_job_name=glue_job_name,
            integration_pattern=sfn.IntegrationPattern.RUN_JOB
        ).add_retry(
            errors=['Glue.ConcurrentRunsExceededException'],
            interval=Duration.seconds(10),
            max_attempts=3,
            backoff_rate=1.5
        ).add_catch(
            failed_state,
            errors=['States.ALL'],
            result_path='$.error'
        )

        # Choice for ETL mode
        etl_choice = sfn.Choice(self, 'EtlModeChoice')
        success = sfn.Succeed(self, 'Success')

        # DLQをクラス変数として保存（他のスタックから参照可能）
        self.dlq = dlq

        # s3_direct branch: Fetch → set nlp_input → NLP
        s3_chain = fetch.next(
            sfn.Pass(self, 'SetNlpInputS3', parameters={"nlp_input": {"record": {"text.$": "$.text"}}})
        ).next(nlp)

        # textract branch（簡易: 実運用ではTextract Start/Wait/Getのループ/エラー処理を追加）
        # ここではダミーで NLP に渡す形にしておく（本格化は次版で拡張可能）
        textract_chain = sfn.Pass(self, 'TextractStub', parameters={"nlp_input": {"record": {"text": "OCR抽出テキスト（PoC）"}}}).next(nlp)

        pipeline_choice = sfn.Choice(self, 'PipelineModeChoice')
        definition = pipeline_choice            .when(sfn.Condition.string_equals('s3_direct', pipeline_mode), s3_chain)            .when(sfn.Condition.string_equals('textract', pipeline_mode), textract_chain)            .otherwise(s3_chain)

        # ETL モードの分岐（Lambda 直Parquet か Glue ETL）
        etl_definition = etl_choice            .when(sfn.Condition.string_equals('glue', cfg['etl']['mode']), glue_job.next(success))            .otherwise(success)

        sm = sfn.StateMachine(self, 'VocPipelineSm',
                              definition=definition.next(etl_definition),
                              timeout=Duration.minutes(10))

        # S3 put → EventBridge → StartExecution（raw バケット）
        rule = events.Rule(self, 'RawIngestRule',
                           event_pattern=events.EventPattern(
                               source=["aws.s3"],
                               detail_type=["Object Created"],
                               detail={"bucket": {"name": [buckets['raw'].bucket_name]}}
                           ))
        rule.add_target(targets.SfnStateMachine(sm))

        # エクスポート（モニタリングスタックで使用）
        self.state_machine = sm
        self.pipeline_dlq = dlq
