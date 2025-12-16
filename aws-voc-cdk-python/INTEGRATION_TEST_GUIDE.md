# 📋 集成测试执行指南

## 概要

本指南说明如何执行AWS VOC CDK项目的集成测试（端到端测试）。集成测试会验证整个数据处理管道的功能，从S3上传到QuickSight可视化。

---

## ⚠️ 前提条件

### 1. AWS环境部署完成
```bash
# 确保所有CDK栈已部署
cdk deploy --all
```

### 2. AWS凭证配置
```bash
# 方法1: 环境变量
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=ap-northeast-1

# 方法2: AWS CLI配置
aws configure
```

### 3. Python依赖安装
```bash
pip install -r requirements-dev.txt
```

---

## 🧪 测试用例列表

### 基础设施测试

#### 1. `test_s3_buckets_exist` - S3バケット存在確認
- **目的**: 验证所有S3存储桶已创建
- **检查项目**:
  - `{prefix}-raw-apne1` - 原始数据存储桶
  - `{prefix}-textract-apne1` - Textract输出存储桶
  - `{prefix}-processed-apne1` - 处理后数据存储桶
  - `{prefix}-quicksight-apne1` - QuickSight数据存储桶
  - `{prefix}-archive-apne1` - 归档存储桶

#### 2. `test_step_functions_exists` - Step Functions確認
- **目的**: 验证Step Functions状态机已创建
- **检查项目**: `{prefix}-pipeline-VocPipelineSm`

#### 3. `test_lambda_functions_exist` - Lambda関数確認 🆕
- **目的**: 验证所有Lambda函数已部署
- **检查项目**:
  - fetch_s3text Lambda
  - voc_nlp Lambda
  - quicksight_lambda Lambda

#### 4. `test_dlq_exists` - DLQ存在確認
- **目的**: 验证Dead Letter Queue已创建
- **检查项目**: SQS队列（包含"dlq"关键字）

#### 5. `test_cloudwatch_alarms_exist` - CloudWatchアラーム確認 🆕
- **目的**: 验证CloudWatch告警已配置
- **检查项目**: 所有告警的状态

#### 6. `test_glue_crawler_exists` - Glue Crawler確認 🆕
- **目的**: 验证Glue Crawler已创建
- **检查项目**: Crawler状态（READY或RUNNING）

---

### 端到端功能测试

#### 7. `test_end_to_end_pipeline` - 完整パイプラインテスト
- **目的**: 验证完整的数据处理流程
- **流程**:
  1. 上传测试文件到raw存储桶
  2. EventBridge触发Step Functions
  3. Lambda函数处理数据
  4. 生成Parquet文件到processed存储桶
- **超时**: 5分钟
- **验证**: Parquet文件已生成

#### 8. `test_end_to_end_with_japanese_text` - 日本語テキストテスト 🆕
- **目的**: 验证日语文本处理
- **输入**: 包含日语的多行文本
- **验证**: Step Functions执行成功

#### 9. `test_error_handling_invalid_file` - エラーハンドリングテスト 🆕
- **目的**: 验证错误处理机制
- **输入**: 空文件
- **验证**: 
  - 空文件被正常处理（不进入DLQ）
  - 没有未处理的错误

#### 10. `test_athena_query` - Athenaクエリテスト
- **目的**: 验证Athena查询功能
- **操作**: 执行`SHOW TABLES`查询
- **超时**: 60秒
- **验证**: 查询成功完成

---

## 🚀 执行测试

### 方法1: 执行所有集成测试
```bash
pytest tests/integration/ -v -m integration
```

### 方法2: 执行特定测试
```bash
# 只测试基础设施
pytest tests/integration/test_pipeline.py::test_s3_buckets_exist -v

# 只测试端到端流程
pytest tests/integration/test_pipeline.py::test_end_to_end_pipeline -v

# 只测试日语文本处理
pytest tests/integration/test_pipeline.py::test_end_to_end_with_japanese_text -v
```

### 方法3: 生成详细报告
```bash
pytest tests/integration/ -v -m integration --tb=short --html=integration_report.html
```

---

## 📊 预期输出

### 成功示例
```
tests/integration/test_pipeline.py::test_s3_buckets_exist PASSED                    [ 10%]
tests/integration/test_pipeline.py::test_step_functions_exists PASSED               [ 20%]
tests/integration/test_pipeline.py::test_lambda_functions_exist PASSED              [ 30%]
tests/integration/test_pipeline.py::test_dlq_exists PASSED                          [ 40%]
tests/integration/test_pipeline.py::test_cloudwatch_alarms_exist PASSED             [ 50%]
tests/integration/test_pipeline.py::test_glue_crawler_exists PASSED                 [ 60%]
tests/integration/test_pipeline.py::test_end_to_end_pipeline PASSED                 [ 70%]
tests/integration/test_pipeline.py::test_end_to_end_with_japanese_text PASSED       [ 80%]
tests/integration/test_pipeline.py::test_error_handling_invalid_file PASSED         [ 90%]
tests/integration/test_pipeline.py::test_athena_query PASSED                        [100%]

========================== 10 passed in 120.45s ==========================
```

---

## ⚠️ 常见问题

### 问题1: 测试超时
**症状**: `test_end_to_end_pipeline` 超时失败

**原因**:
- Step Functions执行时间过长
- EventBridge规则未触发
- Lambda函数执行失败

**解决方法**:
```bash
# 1. 检查Step Functions执行历史
aws stepfunctions list-executions \
  --state-machine-arn <state-machine-arn> \
  --max-results 10

# 2. 检查CloudWatch日志
aws logs tail /aws/lambda/{prefix}-fetch --follow
aws logs tail /aws/lambda/{prefix}-nlp --follow

# 3. 检查EventBridge规则
aws events list-rules --name-prefix {prefix}
```

### 问题2: S3存储桶不存在
**症状**: `test_s3_buckets_exist` 失败

**原因**: CDK部署未完成或失败

**解决方法**:
```bash
# 重新部署storage栈
cdk deploy softroad-voc-storage

# 验证存储桶
aws s3 ls | grep {prefix}
```

### 问题3: Lambda函数未找到
**症状**: `test_lambda_functions_exist` 失败

**原因**: Lambda栈部署失败

**解决方法**:
```bash
# 重新部署Lambda栈
cdk deploy softroad-voc-lambda

# 验证Lambda函数
aws lambda list-functions | grep {prefix}
```

### 问题4: Athena查询失败
**症状**: `test_athena_query` 失败

**原因**:
- Glue数据库未创建
- Athena工作组配置错误
- 结果位置S3存储桶不存在

**解决方法**:
```bash
# 1. 检查Glue数据库
aws glue get-database --name {database_name}

# 2. 检查Athena工作组
aws athena get-work-group --work-group {workgroup_name}

# 3. 运行Glue Crawler
aws glue start-crawler --name {prefix}-voc-crawler
```

---

## 🔍 调试技巧

### 1. 启用详细日志
```bash
pytest tests/integration/ -v -s -m integration
```

### 2. 只运行失败的测试
```bash
pytest tests/integration/ --lf -v
```

### 3. 使用pdb调试
```python
# 在测试代码中添加断点
import pdb; pdb.set_trace()
```

### 4. 检查AWS资源状态
```bash
# S3存储桶
aws s3 ls

# Lambda函数
aws lambda list-functions --query 'Functions[?contains(FunctionName, `{prefix}`)].FunctionName'

# Step Functions
aws stepfunctions list-state-machines --query 'stateMachines[?contains(name, `{prefix}`)].name'

# SQS队列
aws sqs list-queues --queue-name-prefix {prefix}

# CloudWatch告警
aws cloudwatch describe-alarms --alarm-name-prefix {prefix}
```

---

## 📈 测试覆盖范围

| 组件 | 测试用例数 | 覆盖率 |
|------|-----------|--------|
| **S3存储桶** | 1 | ✅ 100% |
| **Lambda函数** | 1 | ✅ 100% |
| **Step Functions** | 3 | ✅ 100% |
| **DLQ** | 2 | ✅ 100% |
| **CloudWatch** | 1 | ✅ 100% |
| **Glue** | 1 | ✅ 100% |
| **Athena** | 1 | ✅ 100% |
| **端到端流程** | 3 | ✅ 100% |

---

## 🎯 最佳实践

### 1. 测试前清理
```bash
# 清理旧的测试文件
aws s3 rm s3://{prefix}-raw-apne1/inbox/ --recursive --exclude "*" --include "test_*"
```

### 2. 测试后验证
```bash
# 检查DLQ是否有消息
aws sqs get-queue-attributes \
  --queue-url <dlq-url> \
  --attribute-names ApproximateNumberOfMessages
```

### 3. 定期执行
```bash
# 使用cron定期执行集成测试
0 2 * * * cd /path/to/project && pytest tests/integration/ -v -m integration
```

---

## 📝 测试报告

测试完成后，可以生成HTML报告：

```bash
pytest tests/integration/ -v -m integration --html=integration_report.html --self-contained-html
```

报告包含：
- ✅ 测试通过/失败统计
- ⏱️ 执行时间
- 📋 详细日志
- 🔍 错误堆栈跟踪

---

## 🚦 CI/CD集成

### GitHub Actions示例
```yaml
name: Integration Tests

on:
  push:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨2点

jobs:
  integration-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-1
      - name: Run integration tests
        run: |
          pip install -r requirements-dev.txt
          pytest tests/integration/ -v -m integration
```

---

## 📞 支持

如果遇到问题，请参考：
1. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - 故障排除指南
2. [README.md](./README.md) - 项目文档
3. CloudWatch Logs - 实时日志

---

**最后更新**: 2025-11-10  
**版本**: 1.0.0

