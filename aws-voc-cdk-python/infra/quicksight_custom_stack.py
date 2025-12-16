# -*- coding: utf-8 -*-
from aws_cdk import (Stack, custom_resources as cr, Duration, aws_lambda as _lambda, aws_iam as iam)
from constructs import Construct
import os

class QuickSightCustomStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, glue_athena: dict, buckets: dict, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        qs_lambda_role = iam.Role(self, 'QsLambdaRole', assumed_by=iam.ServicePrincipal('lambda.amazonaws.com'))
        qs_lambda_role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name('service-role/AWSLambdaBasicExecutionRole'))
        qs_lambda_role.add_to_policy(iam.PolicyStatement(
            actions=[
                'quicksight:CreateDataSource','quicksight:DescribeDataSource','quicksight:UpdateDataSource','quicksight:DeleteDataSource',
                'quicksight:CreateDataSet','quicksight:DescribeDataSet','quicksight:UpdateDataSet','quicksight:DeleteDataSet',
                'quicksight:CreateDashboard','quicksight:UpdateDashboard','quicksight:DescribeDashboard','quicksight:DeleteDashboard',
                'quicksight:CreateIngestion','quicksight:PutDataSetRefreshProperties','quicksight:CreateRefreshSchedule','quicksight:UpdateRefreshSchedule'
            ],
            resources=['*']
        ))

        qs_fn = _lambda.Function(self, 'QuickSightProvisioner',
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler='handler.on_event',
            code=_lambda.Code.from_asset(os.path.join(os.path.dirname(__file__), 'quicksight_lambda')),
            timeout=Duration.minutes(5),
            role=qs_lambda_role,
            environment={'REGION': self.region}
        )

        provider = cr.Provider(self, 'QuickSightProvider', on_event_handler=qs_fn)

        self.resource = cr.CustomResource(self, 'QuickSightSetup',
            service_token=provider.service_token,
            properties={
                'Config': cfg,
                'GlueDbName': glue_athena['glue_db_name'],
                'ProcessedBucket': buckets['processed'].bucket_name
            })
