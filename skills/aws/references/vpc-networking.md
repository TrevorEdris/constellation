# VPC Networking — Reference

VPC fundamentals, subnet design, security groups, NACLs, and VPC endpoints.

---

## VPC Design Principles

| Decision | Recommendation |
|----------|---------------|
| CIDR sizing | `/16` per VPC (65,536 IPs); `/24` per subnet (251 usable — AWS reserves 5) |
| Subnet tiers | Public (internet-facing ALBs), Private (compute: ECS, Lambda in VPC), Isolated (databases) |
| AZ coverage | Deploy subnets in 3 AZs minimum for production; 2 AZs acceptable for non-critical dev |
| Overlapping CIDRs | Avoid — breaks VPC peering and Transit Gateway routing; document your org's CIDR allocation |

### Recommended Subnet Layout (per AZ)

```
VPC: 10.0.0.0/16
├── Public subnets (ALB, NAT Gateway)
│   ├── 10.0.1.0/24 (AZ-a)
│   ├── 10.0.2.0/24 (AZ-b)
│   └── 10.0.3.0/24 (AZ-c)
├── Private subnets (ECS, Lambda, EKS nodes)
│   ├── 10.0.11.0/24 (AZ-a)
│   ├── 10.0.12.0/24 (AZ-b)
│   └── 10.0.13.0/24 (AZ-c)
└── Isolated subnets (RDS, ElastiCache)
    ├── 10.0.21.0/24 (AZ-a)
    ├── 10.0.22.0/24 (AZ-b)
    └── 10.0.23.0/24 (AZ-c)
```

---

## Internet Connectivity

| Route | Use When |
|-------|---------|
| **Internet Gateway (IGW)** | Resources need inbound internet access (public subnets) |
| **NAT Gateway** | Private subnet resources need outbound-only internet access |
| **No internet route** | Isolated DB subnets — access only from within VPC |

```bash
# NAT Gateway — create one per AZ for HA (or one shared for cost-optimized dev)
aws ec2 create-nat-gateway \
  --subnet-id subnet-public-aza \
  --allocation-id eipalloc-xxx  # Elastic IP required

# Add default route in private subnet route table
aws ec2 create-route \
  --route-table-id rtb-private-aza \
  --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id nat-xxx
```

NAT Gateway costs ~$0.045/hour + $0.045/GB data processed — use VPC endpoints to avoid NAT costs for AWS services.

---

## Security Groups

Security groups are **stateful** — return traffic is automatically allowed regardless of outbound rules.

### Design Rules

1. Create separate security groups per tier (ALB, app, database)
2. Reference security groups by ID for intra-VPC rules — not CIDR blocks
3. Never allow `0.0.0.0/0` inbound except on internet-facing ALBs (port 443/80)
4. Restrict egress: allow only what the workload needs to reach

### Example: Three-Tier Setup

```
# ALB Security Group
Inbound:  443 from 0.0.0.0/0 (HTTPS from internet)
          80  from 0.0.0.0/0 (redirect to HTTPS)
Outbound: 8080 to sg-app (app traffic)

# App Security Group (ECS / Lambda)
Inbound:  8080 from sg-alb (traffic from ALB only)
Outbound: 5432 to sg-db  (PostgreSQL to DB)
          443  to 0.0.0.0/0 (HTTPS to AWS services; replace with VPC endpoints)

# DB Security Group (RDS)
Inbound:  5432 from sg-app (PostgreSQL from app only)
Outbound: (none required — stateful SG allows return traffic)
```

---

## Network ACLs (NACLs)

NACLs are **stateless** — both inbound and outbound rules must explicitly allow return traffic.

Use NACLs for:
- Blocking specific IPs or CIDR ranges (not possible with security groups)
- Compliance requirements for explicit subnet-level deny rules

For most use cases, security groups alone are sufficient.

```bash
# Block a CIDR in a NACL (rules evaluated in ascending order; first match wins)
aws ec2 create-network-acl-entry \
  --network-acl-id acl-xxx \
  --rule-number 90 \
  --protocol -1 \
  --rule-action deny \
  --ingress \
  --cidr-block 1.2.3.0/24
```

---

## VPC Endpoints

Replace NAT Gateway egress to AWS services with free (Gateway) or hourly-billed (Interface) endpoints.

| Type | Services | Cost |
|------|---------|------|
| **Gateway** | S3, DynamoDB | Free |
| **Interface** (PrivateLink) | All other AWS services | $0.01/hour/AZ + $0.01/GB |

```bash
# S3 Gateway endpoint (free — always add this)
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxx \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-private-aza rtb-private-azb rtb-private-azc

# Secrets Manager Interface endpoint (private subnet — no NAT needed)
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxx \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.us-east-1.secretsmanager \
  --subnet-ids subnet-private-aza subnet-private-azb \
  --security-group-ids sg-app
```

**Common interface endpoints for production:**
- `secretsmanager` — secret injection without NAT
- `ssm`, `ssmmessages`, `ec2messages` — Systems Manager Session Manager access
- `ecr.api`, `ecr.dkr` — ECR pulls without NAT
- `logs` — CloudWatch Logs without NAT

---

## Flow Logs

Enable VPC Flow Logs for all production VPCs. Required for most compliance frameworks.

```bash
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-xxx \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-destination arn:aws:logs:us-east-1:ACCOUNT:log-group:vpc-flow-logs \
  --deliver-logs-permission-arn arn:aws:iam::ACCOUNT:role/FlowLogsRole
```

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Lambda in VPC without NAT / endpoint | Lambda can't reach internet or AWS services | Add NAT or VPC endpoints |
| Using default VPC for production | Non-deletable; all subnets public; shared with other resources | Create a dedicated VPC |
| Single AZ NAT Gateway | NAT Gateway failure takes down all private subnet internet access | One NAT per AZ |
| SG referencing CIDR for same-VPC services | Brittle; breaks if IP changes | Reference by SG ID |
| No VPC flow logs | Blind to network traffic patterns and security events | Enable flow logs on all prod VPCs |
