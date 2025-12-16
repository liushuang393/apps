# -*- coding: utf-8 -*-
from aws_cdk import (Stack, aws_glue as glue, aws_iam as iam)
from constructs import Construct

class GlueJobStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, buckets: dict, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        job_name = cfg['etl']['glue_job_name']
        worker_type = cfg['etl']['glue_worker_type']
        number_workers = cfg['etl']['glue_number_workers']
        script_location = cfg['etl']['glue_script_path']

        # Glue Job Role
        role = iam.Role(self, 'GlueJobRole', assumed_by=iam.ServicePrincipal('glue.amazonaws.com'))
        buckets['processed'].grant_read_write(role)
        buckets['archive'].grant_read_write(role)

        glue.CfnJob(self, 'JsonToParquetJob',
            name=job_name,
            role=role.role_arn,
            command=glue.CfnJob.JobCommandProperty(
                name="glueetl",
                python_version="3",
                script_location=script_location
            ),
            glue_version="4.0",
            worker_type=worker_type,
            number_of_workers=number_workers,
            default_arguments={
                "--job-language": "python",
                "--enable-metrics": "true",
                "--enable-continuous-cloudwatch-log": "true",
                "--SOURCE_S3": f"s3://{buckets['processed'].bucket_name}/raw-json/",
                "--TARGET_S3": f"s3://{buckets['processed'].bucket_name}/curated/"
            }
        )
