# -*- coding: utf-8 -*-
from aws_cdk import (Stack, aws_glue as glue, aws_iam as iam, aws_athena as athena)
from constructs import Construct

class GlueAthenaStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, cfg: dict, buckets: dict, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        db_name = cfg['athena']['database_name']
        crawler_name = cfg['athena']['crawler_name']
        result_loc = cfg['athena']['result_location_s3']

        # Glue Database
        db = glue.CfnDatabase(self, 'GlueDb',
                              catalog_id=self.account,
                              database_input=glue.CfnDatabase.DatabaseInputProperty(name=db_name))

        # IAM Role for Crawler
        crawler_role = iam.Role(self, 'CrawlerRole', assumed_by=iam.ServicePrincipal('glue.amazonaws.com'))
        buckets['processed'].grant_read(crawler_role)

        crawler = glue.CfnCrawler(self, 'ProcessedCrawler',
            name=crawler_name,
            role=crawler_role.role_arn,
            targets=glue.CfnCrawler.TargetsProperty(
                s3_targets=[glue.CfnCrawler.S3TargetProperty(path=f"s3://{buckets['processed'].bucket_name}/curated/")]
            ),
            database_name=db_name,
            recrawl_policy=glue.CfnCrawler.RecrawlPolicyProperty(recrawl_behavior="CRAWL_EVERYTHING"),
        )

        # Athena WorkGroup（結果出力先をS3に）
        wg = athena.CfnWorkGroup(self, 'WorkGroup',
            name=cfg['athena']['workgroup_name'],
            work_group_configuration=athena.CfnWorkGroup.WorkGroupConfigurationProperty(
                result_configuration=athena.CfnWorkGroup.ResultConfigurationProperty(
                    output_location=result_loc
                )
            )
        )

        self.outputs = {"glue_db_name": db_name, "workgroup": wg.name}
