# AWS IAM Compliance Checklist

CIS AWS Foundations Benchmark v1.5, CloudTrail setup, and Config rules.

---

## CIS AWS Foundations Benchmark v1.5 — IAM Controls

### Identity and Access Management

| ID | Control | Check | Pass Criteria |
|----|---------|-------|--------------|
| 1.1 | Maintain current contact details | AWS account | Email, phone, and billing contact are up to date |
| 1.4 | Ensure no root account access keys exist | `aws iam get-account-summary` | `AccountAccessKeysPresent = 0` |
| 1.5 | Ensure MFA is enabled for root account | Console → IAM Dashboard | "MFA on root account: Enabled" |
| 1.6 | Ensure hardware MFA is enabled for root | Console → Security credentials | Hardware MFA device listed |
| 1.7 | Eliminate use of root account for daily tasks | CloudTrail logs | Root login events are zero or near-zero |
| 1.8 | Password policy: 14+ chars minimum | `aws iam get-account-password-policy` | `MinimumPasswordLength >= 14` |
| 1.9 | Password policy: prevent reuse (24 passwords) | Same command | `PasswordReusePrevention >= 24` |
| 1.10 | MFA enabled for all IAM users with console access | `aws iam generate-credential-report` | All console users have MFA |
| 1.11 | Do not set up access keys during initial user setup | Credential report | No access keys created at same time as user |
| 1.12 | Remove credentials unused for >90 days | Credential report | `password_last_used` and `access_key_X_last_used_date` within 90 days |
| 1.13 | One active access key per user | `aws iam list-access-keys` | No user has two active access keys |
| 1.14 | Rotate access keys every 90 days | Credential report | All keys rotated within 90 days |
| 1.15 | IAM policies attached to groups or roles, not users | `aws iam list-users` | No `AttachedManagedPolicies` on users directly |
| 1.16 | Ensure IAM policies that allow full `*:*` are not attached | Access Analyzer | No policies with `Action: "*"` and `Resource: "*"` attached |
| 1.17 | Support role for incident management | Console | AWS Support plan and designated support role exist |
| 1.18 | IAM instance roles for EC2 | EC2 console | All EC2 instances have IAM roles; no access keys on instances |
| 1.20 | Analyze unused permissions regularly | IAM Access Advisor | Review every 90 days; remove unused permissions |
| 1.21 | IAM external access analyzer enabled | `aws accessanalyzer list-analyzers` | At least one active analyzer with type ACCOUNT |

---

## CloudTrail Setup Checklist

CloudTrail is required by CIS and most compliance frameworks (SOC 2, PCI DSS, HIPAA).

```bash
# Create a multi-region trail with log file validation
aws cloudtrail create-trail \
  --name org-management-trail \
  --s3-bucket-name my-cloudtrail-logs \
  --is-multi-region-trail \
  --enable-log-file-validation \
  --include-global-service-events \
  --cloud-watch-logs-log-group-arn arn:aws:logs:us-east-1:ACCOUNT:log-group:CloudTrail/DefaultLogGroup \
  --cloud-watch-logs-role-arn arn:aws:iam::ACCOUNT:role/CloudTrail-CWLogs-Role

aws cloudtrail start-logging --name org-management-trail
```

### CIS CloudTrail Controls

| ID | Control | CLI Check |
|----|---------|-----------|
| 3.1 | CloudTrail enabled in all regions | `aws cloudtrail describe-trails --include-shadow-trails` → `IsMultiRegionTrail: true` |
| 3.2 | CloudTrail log file validation enabled | `LogFileValidationEnabled: true` |
| 3.3 | AWS Config enabled in all regions | `aws configservice describe-configuration-recorder-status` |
| 3.4 | S3 bucket for CloudTrail not publicly accessible | `aws s3api get-bucket-acl --bucket BUCKET` |
| 3.5 | S3 access logging enabled for CloudTrail bucket | `aws s3api get-bucket-logging --bucket BUCKET` |
| 3.6 | CloudTrail integrated with CloudWatch Logs | `CloudWatchLogsLogGroupArn` set on trail |
| 3.7 | AWS Config enabled | Recorder status Active |
| 3.8 | S3 bucket policy denial applied | Check bucket policy for explicit deny |
| 3.9 | VPC flow logging enabled | `aws ec2 describe-flow-logs --filter Name=resource-type,Values=VPC` |
| 3.10 | AWS Config configured to record all resource types | `aws configservice describe-configuration-recorders` → `allSupported: true` |
| 3.11 | SNS topic on CloudTrail trail | `aws cloudtrail get-trail --name TRAIL` → `SNSTopicARN` set |

---

## CloudWatch Metric Filters (CIS Section 4)

Required alarms for security-relevant events:

```bash
# Template: Create a metric filter + alarm
create_alarm() {
  local name=$1 pattern=$2 metric=$3 threshold=$4 log_group=$5

  aws logs put-metric-filter \
    --log-group-name "$log_group" \
    --filter-name "$name" \
    --filter-pattern "$pattern" \
    --metric-transformations \
      metricName="$metric",metricNamespace=CISBenchmark,metricValue=1

  aws cloudwatch put-metric-alarm \
    --alarm-name "$name" \
    --metric-name "$metric" \
    --namespace CISBenchmark \
    --statistic Sum \
    --period 300 \
    --threshold "$threshold" \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --evaluation-periods 1 \
    --alarm-actions arn:aws:sns:REGION:ACCOUNT:security-alerts
}

# 4.1: Unauthorized API calls
create_alarm "UnauthorizedAPICalls" \
  '{($.errorCode="*UnauthorizedAccess") || ($.errorCode="AccessDenied")}' \
  "UnauthorizedAPICalls" 1 "CloudTrail/DefaultLogGroup"

# 4.2: Root login
create_alarm "RootLogin" \
  '{$.userIdentity.type="Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent"}' \
  "RootLogin" 1 "CloudTrail/DefaultLogGroup"

# 4.3: IAM policy changes
create_alarm "IAMPolicyChanges" \
  '{($.eventName=DeleteGroupPolicy) || ($.eventName=DeleteRolePolicy) || ($.eventName=DeleteUserPolicy) || ($.eventName=PutGroupPolicy) || ($.eventName=PutRolePolicy) || ($.eventName=PutUserPolicy) || ($.eventName=CreatePolicy) || ($.eventName=DeletePolicy) || ($.eventName=CreatePolicyVersion) || ($.eventName=DeletePolicyVersion) || ($.eventName=SetDefaultPolicyVersion) || ($.eventName=AttachRolePolicy) || ($.eventName=DetachRolePolicy) || ($.eventName=AttachUserPolicy) || ($.eventName=DetachUserPolicy) || ($.eventName=AttachGroupPolicy) || ($.eventName=DetachGroupPolicy)}' \
  "IAMPolicyChanges" 1 "CloudTrail/DefaultLogGroup"

# 4.4: CloudTrail config changes
create_alarm "CloudTrailChanges" \
  '{($.eventName=CreateTrail) || ($.eventName=UpdateTrail) || ($.eventName=DeleteTrail) || ($.eventName=StartLogging) || ($.eventName=StopLogging)}' \
  "CloudTrailChanges" 1 "CloudTrail/DefaultLogGroup"

# 4.13: Route53 changes
# 4.14: VPC changes
```

---

## AWS Config Rules

```bash
# Enable AWS Config managed rules for IAM compliance

# MFA on root account
aws configservice put-config-rule \
  --config-rule '{"ConfigRuleName":"root-account-mfa-enabled","Source":{"Owner":"AWS","SourceIdentifier":"ROOT_ACCOUNT_MFA_ENABLED"}}'

# IAM password policy
aws configservice put-config-rule \
  --config-rule '{"ConfigRuleName":"iam-password-policy","Source":{"Owner":"AWS","SourceIdentifier":"IAM_PASSWORD_POLICY"},"InputParameters":"{\"RequireUppercaseCharacters\":\"true\",\"RequireLowercaseCharacters\":\"true\",\"RequireSymbols\":\"true\",\"RequireNumbers\":\"true\",\"MinimumPasswordLength\":\"14\",\"PasswordReusePrevention\":\"24\"}"}'

# No access keys on root
aws configservice put-config-rule \
  --config-rule '{"ConfigRuleName":"iam-no-inline-policy-check","Source":{"Owner":"AWS","SourceIdentifier":"IAM_NO_INLINE_POLICY_CHECK"}}'
```

---

## Remediation Automation

Use AWS Security Hub or Config remediation actions to auto-remediate common findings:

| Finding | Auto-Remediation |
|---------|-----------------|
| Access key older than 90 days | Deactivate key (SSM Automation: `AWS-DisableAccessKey`) |
| S3 bucket public | Block public access (SSM Automation: `AWS-DisableS3BucketPublicAccess`) |
| Security group open to internet | Alert only — require human review before revocation |
| CloudTrail stopped | Re-enable (Config remediation via Lambda) |
