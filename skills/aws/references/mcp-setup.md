# AWS MCP Server Setup — Reference

Configure official `awslabs` MCP servers for Claude Code, Cursor, or other MCP-compatible clients.

---

## Prerequisites

- AWS credentials configured and active (see `references/credential-patterns.md`)
- Python 3.10+ and `uv` or `uvx` installed (`pip install uv`)
- IAM permissions matching each server's requirements (see per-server IAM section below)

---

## Transport Note

All `awslabs` MCP servers use **stdio transport** only. SSE transport was removed in May 2025. Configs using `"url":` or `"transport": "sse"` are outdated and will not work.

---

## Claude Code Configuration (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "aws-docs": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server"],
      "env": {
        "AWS_REGION": "us-east-1"
      }
    },
    "aws-iac": {
      "command": "uvx",
      "args": ["awslabs.aws-iac-mcp-server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1"
      }
    },
    "aws-serverless": {
      "command": "uvx",
      "args": ["awslabs.aws-serverless-mcp-server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1"
      }
    },
    "aws-cloudwatch": {
      "command": "uvx",
      "args": ["awslabs.cloudwatch-mcp-server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1"
      }
    }
  }
}
```

Full config with all servers: `assets/mcp-config-examples/claude-code-mcp.json`

---

## Cursor Configuration (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "aws-docs": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server"]
    }
  }
}
```

Full config: `assets/mcp-config-examples/cursor-mcp.json`

---

## Available Servers

| Server | Package | Best For | Cost |
|--------|---------|----------|------|
| AWS Documentation | `awslabs.aws-documentation-mcp-server` | Full-text AWS docs search | Free |
| AWS IaC | `awslabs.aws-iac-mcp-server` | CDK/CloudFormation validation, deployment help | Free |
| AWS Serverless | `awslabs.aws-serverless-mcp-server` | SAM CLI, Lambda/API GW/Step Functions | Free |
| Amazon ECS | `awslabs.ecs-mcp-server` | ECS deployments, ECR push, ALB provisioning | Free |
| Amazon EKS | `awslabs.eks-mcp-server` | Kubernetes cluster management | Free |
| CloudWatch | `awslabs.cloudwatch-mcp-server` | Log Insights, alarms, root cause analysis | Free |
| AWS Cloud Control API | `awslabs.ccapi-mcp-server` | CRUDL on 1,100+ resource types | Free (resource changes may cost) |
| AWS Cost Explorer | `awslabs.cost-explorer-mcp-server` | Cost/usage queries | **$0.01/request** |
| AWS Pricing | `awslabs.aws-pricing-mcp-server` | Pricing lookup, cost estimation | Free |
| Amazon ElastiCache | `awslabs.elasticache-mcp-server` | Valkey/Memcached data operations | Free |

---

## IAM Requirements Per Server

### AWS Documentation MCP
No AWS actions required — fetches public documentation only.

### AWS IaC MCP
```json
{
  "Action": [
    "cloudformation:ValidateTemplate",
    "cloudformation:DescribeStacks",
    "cloudformation:DescribeStackEvents",
    "cloudformation:ListStacks"
  ],
  "Resource": "*"
}
```

### AWS Serverless MCP
Requires SAM CLI to be installed (`brew install aws-sam-cli`). IAM: Lambda, API Gateway, and CloudFormation read permissions.

### Amazon ECS MCP
```json
{
  "Action": [
    "ecs:*",
    "ecr:GetAuthorizationToken",
    "ecr:BatchGetImage",
    "ecr:InitiateLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload",
    "ecr:PutImage",
    "elasticloadbalancing:*",
    "cloudformation:CreateStack",
    "cloudformation:UpdateStack",
    "cloudformation:DescribeStacks",
    "iam:PassRole"
  ]
}
```

This is a wide permission set — scope `iam:PassRole` to specific role ARNs using a condition.

### CloudWatch MCP
```json
{
  "Action": [
    "logs:DescribeLogGroups",
    "logs:DescribeLogStreams",
    "logs:GetLogEvents",
    "logs:StartQuery",
    "logs:GetQueryResults",
    "cloudwatch:DescribeAlarms",
    "cloudwatch:GetMetricData"
  ],
  "Resource": "*"
}
```

### AWS Cloud Control API MCP

Wide blast radius — this server can CRUDL any resource type. Scope with conditions:

```json
{
  "Action": ["cloudcontrol:*"],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": ["us-east-1", "us-west-2"]
    },
    "ForAnyValue:StringLike": {
      "cloudformation:ResourceTypes": ["AWS::S3::*", "AWS::Lambda::*"]
    }
  }
}
```

### AWS Cost Explorer MCP

```json
{
  "Action": ["ce:GetCostAndUsage", "ce:GetUsageForecast"],
  "Resource": "*"
}
```

Monitor usage with Cost Anomaly Detection — each tool call costs $0.01.

---

## Security Checklist

- [ ] Each MCP server runs with its own dedicated IAM role or profile (not your admin profile)
- [ ] `ccapi-mcp-server` has `aws:RequestedRegion` condition to limit blast radius
- [ ] Cost Explorer MCP access is restricted to non-prod or monitored with Cost Anomaly Detection
- [ ] Community CLI-passthrough servers are treated as equivalent to shell access — evaluated and sandboxed
- [ ] AWS Knowledge MCP and AWS API MCP are AWS-hosted — data leaves your environment; reviewed for compliance before use with sensitive queries

---

## Testing MCP Connection

```bash
# Verify the MCP server starts and credentials resolve
uvx awslabs.aws-documentation-mcp-server --help

# Test with Claude Code
# In a conversation: "Search AWS docs for S3 presigned URL expiration limits"
```
