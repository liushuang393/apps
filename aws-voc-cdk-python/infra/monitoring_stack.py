# -*- coding: utf-8 -*-
# 目的: モニタリングとアラートの設定
# 入力: Lambda関数、Step Functions、DLQ
# 出力: CloudWatchアラート、SNS通知
# 注意: 本番運用に必要なアラート設定

from aws_cdk import (
    Stack,
    Duration,
    aws_cloudwatch as cw,
    aws_cloudwatch_actions as cw_actions,
    aws_sns as sns,
    aws_sns_subscriptions as subscriptions,
    aws_logs as logs
)
from constructs import Construct

class MonitoringStack(Stack):
    """
    目的: システム全体のモニタリングとアラート
    入力: Lambda関数、Step Functions、DLQ、設定情報
    出力: CloudWatchアラート、SNSトピック
    注意: アラート閾値は環境に応じて調整
    """
    
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, 
                 lambda_functions: dict, dlqs: dict, state_machine=None, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        prefix = cfg['project']['prefix']
        alert_email = cfg.get('monitoring', {}).get('alert_email', 'admin@example.com')
        
        # SNS トピック（アラート通知用）
        self.alert_topic = sns.Topic(self, 'AlertTopic',
            display_name=f'{prefix} VOC Alerts',
            topic_name=f'{prefix}-voc-alerts'
        )
        
        # メール通知の追加
        self.alert_topic.add_subscription(
            subscriptions.EmailSubscription(alert_email)
        )
        
        # Lambda関数のアラート
        self._create_lambda_alarms(lambda_functions)
        
        # DLQのアラート
        self._create_dlq_alarms(dlqs)
        
        # Step Functionsのアラート
        if state_machine:
            self._create_stepfunctions_alarms(state_machine)
        
        # ログ保持期間の設定
        self._configure_log_retention(cfg, lambda_functions)
    
    def _create_lambda_alarms(self, lambda_functions: dict):
        """
        目的: Lambda関数のアラート作成
        入力: Lambda関数の辞書
        出力: CloudWatchアラート
        注意: エラー、タイムアウト、スロットリングを監視
        """
        for name, fn in lambda_functions.items():
            # エラーアラート
            error_alarm = cw.Alarm(self, f'{name}ErrorAlarm',
                metric=fn.metric_errors(
                    statistic='Sum',
                    period=Duration.minutes(5)
                ),
                threshold=1,
                evaluation_periods=1,
                alarm_description=f'{name} でエラーが発生しました',
                alarm_name=f'{name}-errors',
                treat_missing_data=cw.TreatMissingData.NOT_BREACHING
            )
            error_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))
            
            # タイムアウトアラート
            duration_alarm = cw.Alarm(self, f'{name}DurationAlarm',
                metric=fn.metric_duration(
                    statistic='Average',
                    period=Duration.minutes(5)
                ),
                threshold=fn.timeout.to_seconds() * 0.9,  # タイムアウトの90%
                evaluation_periods=2,
                comparison_operator=cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
                alarm_description=f'{name} の実行時間が長すぎます',
                alarm_name=f'{name}-duration',
                treat_missing_data=cw.TreatMissingData.NOT_BREACHING
            )
            duration_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))
            
            # スロットリングアラート
            throttle_alarm = cw.Alarm(self, f'{name}ThrottleAlarm',
                metric=fn.metric_throttles(
                    statistic='Sum',
                    period=Duration.minutes(5)
                ),
                threshold=5,
                evaluation_periods=1,
                alarm_description=f'{name} でスロットリングが発生しました',
                alarm_name=f'{name}-throttles',
                treat_missing_data=cw.TreatMissingData.NOT_BREACHING
            )
            throttle_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))
    
    def _create_dlq_alarms(self, dlqs: dict):
        """
        目的: DLQのアラート作成
        入力: DLQの辞書
        出力: CloudWatchアラート
        注意: メッセージが溜まったら即座に通知
        """
        for name, queue in dlqs.items():
            alarm = cw.Alarm(self, f'{name}DlqAlarm',
                metric=queue.metric_approximate_number_of_messages_visible(
                    statistic='Maximum',
                    period=Duration.minutes(1)
                ),
                threshold=1,
                evaluation_periods=1,
                alarm_description=f'{name} DLQにメッセージが溜まっています',
                alarm_name=f'{name}-dlq-messages',
                treat_missing_data=cw.TreatMissingData.NOT_BREACHING
            )
            alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))
    
    def _create_stepfunctions_alarms(self, state_machine):
        """
        目的: Step Functionsのアラート作成
        入力: ステートマシン
        出力: CloudWatchアラート
        注意: 実行失敗を監視
        """
        # 実行失敗アラート
        failed_alarm = cw.Alarm(self, 'StepFunctionsFailedAlarm',
            metric=state_machine.metric_failed(
                statistic='Sum',
                period=Duration.minutes(5)
            ),
            threshold=1,
            evaluation_periods=1,
            alarm_description='Step Functions の実行が失敗しました',
            alarm_name='stepfunctions-failed',
            treat_missing_data=cw.TreatMissingData.NOT_BREACHING
        )
        failed_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))
        
        # タイムアウトアラート
        timeout_alarm = cw.Alarm(self, 'StepFunctionsTimeoutAlarm',
            metric=state_machine.metric_timed_out(
                statistic='Sum',
                period=Duration.minutes(5)
            ),
            threshold=1,
            evaluation_periods=1,
            alarm_description='Step Functions の実行がタイムアウトしました',
            alarm_name='stepfunctions-timeout',
            treat_missing_data=cw.TreatMissingData.NOT_BREACHING
        )
        timeout_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))
    
    def _configure_log_retention(self, cfg: dict, lambda_functions: dict):
        """
        目的: CloudWatch Logsの保持期間設定
        入力: 設定情報、Lambda関数
        出力: ログ保持期間の設定
        注意: コスト削減のため古いログを自動削除
        """
        retention_days = cfg.get('monitoring', {}).get('log_retention_days', 30)
        
        # Lambda関数のログ保持期間を設定
        for name, fn in lambda_functions.items():
            logs.LogGroup(self, f'{name}LogGroup',
                log_group_name=f'/aws/lambda/{fn.function_name}',
                retention=logs.RetentionDays(f'DAYS_{retention_days}')
            )

