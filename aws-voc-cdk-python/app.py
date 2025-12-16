# -*- coding: utf-8 -*-
import os, yaml
import aws_cdk as cdk
from infra.storage_stack import StorageStack
from infra.lambda_stack import LambdaStack
from infra.stepfunctions_stack import PipelineStack
from infra.glue_athena_stack import GlueAthenaStack
from infra.glue_job_stack import GlueJobStack
from infra.quicksight_custom_stack import QuickSightCustomStack
from infra.monitoring_stack import MonitoringStack

app = cdk.App()

with open(os.path.join('config','config.yaml'), 'r', encoding='utf-8') as f:
    raw_cfg = yaml.safe_load(f)

prefix = raw_cfg['project']['prefix']

def _subst(v):
    return v.replace('${prefix}', prefix) if isinstance(v, str) else v

cfg = raw_cfg.copy()
cfg['buckets'] = {k: _subst(v) for k,v in raw_cfg['buckets'].items()}
cfg['athena']['result_location_s3'] = _subst(raw_cfg['athena']['result_location_s3'])
cfg['etl']['glue_script_path'] = _subst(raw_cfg['etl']['glue_script_path'])

env = cdk.Environment(account=os.getenv('CDK_DEFAULT_ACCOUNT'), region=raw_cfg['project']['region'])

storage = StorageStack(app, f"{prefix}-storage", cfg=cfg, env=env)
lambda_stack = LambdaStack(app, f"{prefix}-lambda", cfg=cfg, buckets=storage.outputs, env=env)
glue_athena = GlueAthenaStack(app, f"{prefix}-glue-athena", cfg=cfg, buckets=storage.outputs, env=env)
glue_job = GlueJobStack(app, f"{prefix}-glue-job", cfg=cfg, buckets=storage.outputs, env=env)

pipeline = PipelineStack(app, f"{prefix}-pipeline", cfg=cfg, buckets=storage.outputs,
                         nlp_lambda=lambda_stack.nlp_lambda,
                         fetch_s3text=lambda_stack.fetch_s3text_lambda,
                         glue_job_name=cfg['etl']['glue_job_name'],
                         env=env)

qs = QuickSightCustomStack(app, f"{prefix}-quicksight", cfg=cfg, glue_athena=glue_athena.outputs,
                           buckets=storage.outputs, env=env)

# モニタリングスタック
monitoring = MonitoringStack(app, f"{prefix}-monitoring", cfg=cfg,
                            lambda_functions={
                                'nlp': lambda_stack.nlp_lambda,
                                'fetch': lambda_stack.fetch_s3text_lambda
                            },
                            dlqs={
                                'nlp': lambda_stack.nlp_dlq,
                                'fetch': lambda_stack.fetch_dlq,
                                'pipeline': pipeline.pipeline_dlq
                            },
                            state_machine=pipeline.state_machine,
                            env=env)

app.synth()
