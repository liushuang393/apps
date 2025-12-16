# -*- coding: utf-8 -*-
import os, json, boto3, datetime
qs = boto3.client('quicksight', region_name=os.environ.get('REGION'))

def on_event(event, context):
    req_type = event['RequestType']
    props = event['ResourceProperties']
    cfg = props['Config']

    account_id = cfg['quicksight']['account_id']
    principal_arn = cfg['quicksight']['principal_arn']
    ds_name = cfg['quicksight']['data_source_name']
    dataset_name = cfg['quicksight']['dataset_name']
    dashboard_name = cfg['quicksight']['dashboard_name']
    workgroup = cfg['athena']['workgroup_name']
    dbname = props['GlueDbName']

    if req_type in ('Create','Update'):
        _upsert_data_source(account_id, ds_name, workgroup)
        _upsert_dataset(account_id, dataset_name, ds_name, dbname)
        _ensure_refresh_schedule(account_id, dataset_name, cfg['quicksight']['spice_daily_jst'])
        _upsert_dashboard_stub(account_id, dashboard_name, dataset_name, principal_arn)
        return {"Status":"OK"}
    if req_type == 'Delete':
        _safe_delete(account_id, dashboard_name, dataset_name, ds_name)
        return {"Status":"OK"}
    return {"Status":"OK"}

def _upsert_data_source(account_id, ds_name, workgroup):
    try:
        qs.describe_data_source(AwsAccountId=account_id, DataSourceId=ds_name)
        return
    except qs.exceptions.ResourceNotFoundException:
        pass
    qs.create_data_source(
        AwsAccountId=account_id, DataSourceId=ds_name, Name=ds_name, Type='ATHENA',
        DataSourceParameters={'AthenaParameters': {'WorkGroup': workgroup}}
    )

def _upsert_dataset(account_id, dataset_name, ds_name, dbname):
    try:
        qs.describe_data_set(AwsAccountId=account_id, DataSetId=dataset_name)
        return
    except qs.exceptions.ResourceNotFoundException:
        pass
    # 最小の物理テーブル定義（実運用ではビュー固定を推奨）
    physical_table_map = {
        'pt1': {
            'RelationalTable': {
                'DataSourceArn': f"arn:aws:quicksight:ap-northeast-1:{account_id}:datasource/{ds_name}",
                'Catalog': 'AwsDataCatalog',
                'Schema': dbname,
                'Name': 'curated',  # Glueテーブル名に合わせて調整してください
                'InputColumns': [
                    {'Name':'ts_utc','Type':'STRING'},
                    {'Name':'sentiment','Type':'STRING'},
                    {'Name':'neg_score','Type':'DECIMAL'},
                    {'Name':'gen_summary','Type':'STRING'}
                ]
            }
        }
    }
    qs.create_data_set(
        AwsAccountId=account_id, DataSetId=dataset_name, Name=dataset_name,
        ImportMode='SPICE', PhysicalTableMap=physical_table_map
    )

def _ensure_refresh_schedule(account_id, dataset_name, spice_daily_jst):
    hh, mm = spice_daily_jst.split(':')
    # JST → UTC（ざっくり）
    start_after = datetime.datetime.utcnow().replace(microsecond=0).isoformat()
    schedule = {'ScheduleId': f'{dataset_name}-daily', 'ScheduleFrequency': {'Interval': 'DAILY'},
                'StartAfterDateTime': start_after}
    try:
        qs.create_refresh_schedule(AwsAccountId=account_id, DataSetId=dataset_name, Schedule=schedule)
    except Exception:
        qs.update_refresh_schedule(AwsAccountId=account_id, DataSetId=dataset_name, Schedule=schedule)

def _upsert_dashboard_stub(account_id, dashboard_name, dataset_name, principal_arn):
    try:
        qs.describe_dashboard(AwsAccountId=account_id, DashboardId=dashboard_name)
        return
    except qs.exceptions.ResourceNotFoundException:
        pass
    # 雛形: 実運用では Analysis/Template をJSON管理してください
    try:
        qs.create_dashboard(
            AwsAccountId=account_id, DashboardId=dashboard_name, Name=dashboard_name,
            SourceEntity={'SourceEntityArn': f"arn:aws:quicksight:ap-northeast-1:{account_id}:analysis/placeholder",
                          'SourceTemplate': {'DataSetReferences': [{
                              'DataSetArn': f"arn:aws:quicksight:ap-northeast-1:{account_id}:dataset/{dataset_name}",
                              'DataSetPlaceholder': 'pt1'}],
                              'Arn': f"arn:aws:quicksight:ap-northeast-1:{account_id}:template/placeholder"}},
            Permissions=[{'Principal': principal_arn, 'Actions': ['quicksight:DescribeDashboard','quicksight:QueryDashboard']}]
        )
    except Exception:
        pass

def _safe_delete(account_id, dashboard_name, dataset_name, ds_name):
    for fn, key, field in [(qs.delete_dashboard,'DashboardId',dashboard_name),
                           (qs.delete_data_set,'DataSetId',dataset_name),
                           (qs.delete_data_source,'DataSourceId',ds_name)]:
        try:
            fn(AwsAccountId=account_id, **{key: field})
        except Exception:
            pass
