#!/usr/bin/env bash
# detect-iac-type.sh — Detect the AWS IaC tool used in the current project
# Output: one of: cdk, sam, cloudformation, unknown

set -euo pipefail

detect_iac_type() {
  # CDK: presence of cdk.json is definitive
  if [[ -f "cdk.json" ]]; then
    echo "cdk"
    return
  fi

  # SAM: template.yaml with SAM Transform, or samconfig.toml
  if [[ -f "samconfig.toml" ]]; then
    echo "sam"
    return
  fi

  if [[ -f "template.yaml" ]]; then
    if grep -q "AWS::Serverless-2016-10-31" "template.yaml" 2>/dev/null; then
      echo "sam"
      return
    fi
    if grep -q "AWSTemplateFormatVersion" "template.yaml" 2>/dev/null; then
      echo "cloudformation"
      return
    fi
  fi

  if [[ -f "template.json" ]]; then
    if grep -q "AWSTemplateFormatVersion" "template.json" 2>/dev/null; then
      echo "cloudformation"
      return
    fi
  fi

  # Search for CFN files by naming convention
  CFN_FILES=$(find . -maxdepth 4 \( \
    -name "*.cfn.yaml" -o \
    -name "*.cfn.json" -o \
    -name "*.sam.yaml" \
  \) 2>/dev/null | head -1)

  if [[ -n "$CFN_FILES" ]]; then
    if echo "$CFN_FILES" | grep -q "\.sam\."; then
      echo "sam"
    else
      echo "cloudformation"
    fi
    return
  fi

  echo "unknown"
}

TOOL=$(detect_iac_type)
echo "Detected IaC tool: $TOOL"

case "$TOOL" in
  cdk)
    echo ""
    echo "CDK project details:"
    echo "  cdk.json app command: $(jq -r '.app // "not set"' cdk.json 2>/dev/null)"
    echo "  Language: $(ls bin/*.ts 2>/dev/null | head -1 | xargs -I{} echo TypeScript || ls bin/*.py 2>/dev/null | head -1 | xargs -I{} echo Python || echo "unknown")"
    ;;
  sam)
    echo ""
    echo "SAM project details:"
    ls -la template.yaml samconfig.toml 2>/dev/null || true
    ;;
  cloudformation)
    echo ""
    echo "CloudFormation templates found:"
    find . -maxdepth 4 \( -name "*.cfn.yaml" -o -name "*.cfn.json" -o -name "template.yaml" -o -name "template.json" \) 2>/dev/null | head -10
    ;;
  unknown)
    echo ""
    echo "No AWS IaC detected. Use /aws-iac generate to scaffold a new project."
    ;;
esac
