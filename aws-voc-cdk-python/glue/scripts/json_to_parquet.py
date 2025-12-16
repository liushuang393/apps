import sys, os
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

args = getResolvedOptions(sys.argv, ['JOB_NAME','SOURCE_S3','TARGET_S3'])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

source = args['SOURCE_S3']
target = args['TARGET_S3']

# JSON を読み込み → Parquet に書き出し（dt/channel で分割されている前提）
df = spark.read.json(source)
(df.write
   .mode("append")
   .partitionBy("dt","channel")
   .parquet(target))

job.commit()
