# -*- coding: utf-8 -*-
"""
目的: 集成测试环境验证脚本
使用方法: python verify_integration_setup.py
"""

import sys
import os
import yaml
import boto3
from typing import Dict, List, Tuple

# 色の定義（Windows対応）
try:
    import colorama
    colorama.init()
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
except ImportError:
    GREEN = RED = YELLOW = BLUE = RESET = ''

def print_header(text: str):
    """ヘッダーを表示"""
    print(f"\n{BLUE}{'=' * 60}{RESET}")
    print(f"{BLUE}{text:^60}{RESET}")
    print(f"{BLUE}{'=' * 60}{RESET}\n")

def print_success(text: str):
    """成功メッセージを表示"""
    print(f"{GREEN}✓ {text}{RESET}")

def print_error(text: str):
    """エラーメッセージを表示"""
    print(f"{RED}✗ {text}{RESET}")

def print_warning(text: str):
    """警告メッセージを表示"""
    print(f"{YELLOW}⚠ {text}{RESET}")

def print_info(text: str):
    """情報メッセージを表示"""
    print(f"  {text}")

def load_config() -> Dict:
    """設定ファイルを読み込む"""
    config_path = os.path.join(os.path.dirname(__file__), 'config', 'config.yaml')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)
    except Exception as e:
        print_error(f"設定ファイルの読み込みに失敗: {e}")
        sys.exit(1)

def check_python_version() -> bool:
    """Pythonバージョンをチェック"""
    version = sys.version_info
    if version.major >= 3 and version.minor >= 8:
        print_success(f"Python {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print_error(f"Python {version.major}.{version.minor}.{version.micro} (3.8以上が必要)")
        return False

def check_dependencies() -> bool:
    """依存関係をチェック"""
    required_packages = ['boto3', 'pytest', 'yaml', 'moto']
    missing = []
    
    for package in required_packages:
        try:
            __import__(package)
            print_success(f"{package} インストール済み")
        except ImportError:
            print_error(f"{package} 未インストール")
            missing.append(package)
    
    if missing:
        print_warning(f"以下のコマンドでインストールしてください:")
        print_info(f"pip install -r requirements-dev.txt")
        return False
    
    return True

def check_aws_credentials() -> bool:
    """AWS認証情報をチェック"""
    try:
        sts = boto3.client('sts')
        identity = sts.get_caller_identity()
        print_success(f"AWS認証情報OK")
        print_info(f"Account: {identity['Account']}")
        print_info(f"User: {identity['Arn']}")
        return True
    except Exception as e:
        print_error(f"AWS認証情報エラー: {e}")
        print_warning("以下のコマンドで設定してください:")
        print_info("aws configure")
        return False

def check_s3_buckets(config: Dict) -> Tuple[bool, List[str]]:
    """S3バケットをチェック"""
    prefix = config['project']['prefix']
    region = config['project']['region']
    
    expected_buckets = [
        f"{prefix}-raw-apne1",
        f"{prefix}-textract-apne1",
        f"{prefix}-processed-apne1",
        f"{prefix}-quicksight-apne1",
        f"{prefix}-archive-apne1"
    ]
    
    try:
        s3 = boto3.client('s3', region_name=region)
        response = s3.list_buckets()
        existing_buckets = [b['Name'] for b in response['Buckets']]
        
        found = []
        missing = []
        
        for bucket in expected_buckets:
            if bucket in existing_buckets:
                found.append(bucket)
                print_success(f"S3バケット: {bucket}")
            else:
                missing.append(bucket)
                print_error(f"S3バケット未作成: {bucket}")
        
        if missing:
            print_warning("以下のコマンドでデプロイしてください:")
            print_info("cdk deploy softroad-voc-storage")
            return False, missing
        
        return True, []
    except Exception as e:
        print_error(f"S3バケットチェックエラー: {e}")
        return False, expected_buckets

def check_lambda_functions(config: Dict) -> Tuple[bool, List[str]]:
    """Lambda関数をチェック"""
    prefix = config['project']['prefix']
    region = config['project']['region']
    
    expected_keywords = ['fetch', 'nlp', 'quicksight']
    
    try:
        lambda_client = boto3.client('lambda', region_name=region)
        response = lambda_client.list_functions()
        function_names = [f['FunctionName'] for f in response['Functions']]
        
        found = []
        missing = []
        
        for keyword in expected_keywords:
            matching = [name for name in function_names if keyword in name.lower() and prefix in name]
            if matching:
                found.extend(matching)
                print_success(f"Lambda関数: {matching[0]}")
            else:
                missing.append(keyword)
                print_error(f"Lambda関数未作成: {keyword}")
        
        if missing:
            print_warning("以下のコマンドでデプロイしてください:")
            print_info("cdk deploy softroad-voc-lambda")
            return False, missing
        
        return True, []
    except Exception as e:
        print_error(f"Lambda関数チェックエラー: {e}")
        return False, expected_keywords

def check_step_functions(config: Dict) -> bool:
    """Step Functionsをチェック"""
    prefix = config['project']['prefix']
    region = config['project']['region']
    
    try:
        sfn = boto3.client('stepfunctions', region_name=region)
        response = sfn.list_state_machines()
        state_machines = [sm['name'] for sm in response['stateMachines']]
        
        found = [name for name in state_machines if prefix in name]
        
        if found:
            print_success(f"Step Functions: {found[0]}")
            return True
        else:
            print_error("Step Functions未作成")
            print_warning("以下のコマンドでデプロイしてください:")
            print_info("cdk deploy softroad-voc-stepfunctions")
            return False
    except Exception as e:
        print_error(f"Step Functionsチェックエラー: {e}")
        return False

def check_test_files() -> bool:
    """テストファイルをチェック"""
    test_files = [
        'tests/unit/test_fetch_simple.py',
        'tests/integration/test_pipeline.py',
        'tests/integration/conftest.py'
    ]
    
    all_exist = True
    for test_file in test_files:
        if os.path.exists(test_file):
            print_success(f"テストファイル: {test_file}")
        else:
            print_error(f"テストファイル未作成: {test_file}")
            all_exist = False
    
    return all_exist

def main():
    """メイン処理"""
    print_header("AWS VOC CDK - 集成測試環境検証")
    
    # 設定ファイル読み込み
    print(f"{YELLOW}[1/7] 設定ファイルを読み込み中...{RESET}")
    config = load_config()
    print_success(f"設定ファイル読み込み完了")
    print_info(f"Prefix: {config['project']['prefix']}")
    print_info(f"Region: {config['project']['region']}")
    
    # Pythonバージョンチェック
    print(f"\n{YELLOW}[2/7] Pythonバージョンをチェック中...{RESET}")
    python_ok = check_python_version()
    
    # 依存関係チェック
    print(f"\n{YELLOW}[3/7] 依存関係をチェック中...{RESET}")
    deps_ok = check_dependencies()
    
    # AWS認証情報チェック
    print(f"\n{YELLOW}[4/7] AWS認証情報をチェック中...{RESET}")
    aws_ok = check_aws_credentials()
    
    # S3バケットチェック
    print(f"\n{YELLOW}[5/7] S3バケットをチェック中...{RESET}")
    s3_ok, missing_buckets = check_s3_buckets(config)
    
    # Lambda関数チェック
    print(f"\n{YELLOW}[6/7] Lambda関数をチェック中...{RESET}")
    lambda_ok, missing_lambdas = check_lambda_functions(config)
    
    # Step Functionsチェック
    print(f"\n{YELLOW}[7/7] Step Functionsをチェック中...{RESET}")
    sfn_ok = check_step_functions(config)
    
    # テストファイルチェック
    print(f"\n{YELLOW}[追加] テストファイルをチェック中...{RESET}")
    test_ok = check_test_files()
    
    # 結果サマリー
    print_header("検証結果サマリー")
    
    checks = [
        ("Python環境", python_ok),
        ("依存関係", deps_ok),
        ("AWS認証情報", aws_ok),
        ("S3バケット", s3_ok),
        ("Lambda関数", lambda_ok),
        ("Step Functions", sfn_ok),
        ("テストファイル", test_ok)
    ]
    
    for name, status in checks:
        if status:
            print_success(f"{name}: OK")
        else:
            print_error(f"{name}: NG")
    
    all_ok = all(status for _, status in checks)
    
    print()
    if all_ok:
        print(f"{GREEN}{'=' * 60}{RESET}")
        print(f"{GREEN}{'✓ すべてのチェックが成功しました！':^60}{RESET}")
        print(f"{GREEN}{'=' * 60}{RESET}")
        print()
        print("集成測試を実行できます:")
        print_info("pytest tests/integration/ -v -m integration")
        print_info("または")
        print_info("./run_integration_tests.sh  (Linux/Mac)")
        print_info("run_integration_tests.bat   (Windows)")
        return 0
    else:
        print(f"{RED}{'=' * 60}{RESET}")
        print(f"{RED}{'✗ 一部のチェックが失敗しました':^60}{RESET}")
        print(f"{RED}{'=' * 60}{RESET}")
        print()
        print("上記のエラーを修正してから、再度実行してください。")
        return 1

if __name__ == '__main__':
    sys.exit(main())

