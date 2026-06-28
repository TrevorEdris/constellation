# Kafka Patterns Reference

Internals, configuration, and design patterns for Apache Kafka.

---

## Core Concepts

### Topics, Partitions, and Offsets

**Topic:** a named, ordered, immutable log of records. New records are appended to the end. Records are retained by time or size — not removed on consumption.

**Partition:** the unit of parallelism and physical ordering. A topic has N partitions. Records within a partition are strictly ordered by offset. Records across partitions are NOT ordered relative to each other.

**Offset:** the position of a record within a partition. Monotonically increasing integer. Consumers commit offsets to track progress. On restart, the consumer resumes from the last committed offset.

**Segment:** partitions are divided into segment files on disk (default 1GB or 1 week). Old segments are deleted based on retention policy.

### Consumer Groups

A consumer group is a set of consumer instances that cooperate to consume a topic.

**Assignment rule:** each partition is assigned to exactly one consumer in the group at any time.

```
Topic with 6 partitions:
  Consumer group A (3 instances):
    consumer-A-1 → partitions 0, 1
    consumer-A-2 → partitions 2, 3
    consumer-A-3 → partitions 4, 5

  Consumer group B (6 instances):
    consumer-B-1 → partition 0
    consumer-B-2 → partition 1
    ...
    consumer-B-6 → partition 5
```

**Scaling rule:** adding more consumers than partitions does no work — the extra consumers sit idle. Maximum parallel consumers = partition count. Design partition count with peak consumer count in mind.

**Rebalance:** when a consumer joins or leaves the group, Kafka reassigns partitions. During rebalance, consumption pauses (eager protocol) or is minimized (cooperative sticky protocol, preferred).

### Producer Routing

Records are routed to partitions by:
1. **Explicit partition assignment** (producer specifies partition directly)
2. **Partition key hash** (partition = hash(key) % numPartitions) — default and most common
3. **Round-robin** (if no key specified) — even distribution but no ordering guarantee

**Ordering requirement:** to guarantee ordering for a logical entity, use the entity ID as the partition key. All records for `order_id=123` will land in the same partition and be processed in order.

---

## Producer Configuration

### Reliability settings

```properties
# Idempotent producer: prevents duplicate records on retry (recommended for all producers)
enable.idempotence=true

# Wait for all in-sync replicas to acknowledge — strongest durability
acks=all

# Retry on transient errors (safe because idempotence prevents duplicates)
retries=2147483647
max.in.flight.requests.per.connection=5  # keep ≤ 5 for idempotent producers

# Batching: wait for more records before sending (increases throughput, adds latency)
linger.ms=5          # wait 5ms to accumulate batch
batch.size=32768     # max batch size in bytes

# Compression (recommended for high-throughput)
compression.type=lz4  # good ratio + speed; snappy also common
```

### Transactional producer (exactly-once across topics)

Required for: consume-transform-produce pipelines where the output must be atomic with the input offset commit.

```java
props.put("transactional.id", "order-processor-" + instanceId);  // unique per producer instance
producer.initTransactions();

try {
    producer.beginTransaction();
    producer.send(new ProducerRecord<>("order-fulfilled", key, value));
    producer.sendOffsetsToTransaction(offsets, consumerGroup);
    producer.commitTransaction();
} catch (ProducerFencedException e) {
    // Another instance took over this transactional.id; close this producer
    producer.close();
} catch (KafkaException e) {
    producer.abortTransaction();
}
```

**Cost:** transactions add ~10-20% latency overhead. Use only when exactly-once is genuinely required.

---

## Consumer Configuration

### Commit strategies

**Auto-commit (simple, at-most-once safe):**
```properties
enable.auto.commit=true
auto.commit.interval.ms=5000
```
Risk: if the process crashes after auto-commit but before finishing processing, messages are lost.

**Manual commit after processing (at-least-once, preferred):**
```java
while (true) {
    ConsumerRecords<String, byte[]> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, byte[]> record : records) {
        processRecord(record);  // process first
    }
    consumer.commitSync();  // commit only after processing batch
}
```
Risk: if the process crashes after processing but before committing, messages are redelivered — consumer must be idempotent.

**Manual commit before processing (at-most-once):**
```java
consumer.commitSync();  // commit first
processRecord(record);  // then process; loss is possible if crash here
```
Use only when message loss is preferable to duplicate processing (telemetry, non-critical events).

### Important consumer settings

```properties
# How long to wait for a poll before considering the consumer dead and triggering rebalance
max.poll.interval.ms=300000  # 5 minutes; increase for slow processing
session.timeout.ms=45000     # How long broker waits before considering consumer dead

# Fetch settings
fetch.min.bytes=1            # Minimum data to fetch in one request
fetch.max.wait.ms=500        # Maximum time to wait for fetch.min.bytes
max.poll.records=500         # Maximum records per poll call

# Offset reset: what to do when no committed offset exists
auto.offset.reset=earliest   # Re-process all existing messages (safest for new consumer groups)
# auto.offset.reset=latest   # Skip to newest (use for real-time consumers that don't need history)
```

### Rebalance protocols

**Eager (legacy):** all partitions revoked from all consumers; all reassigned. Causes a processing pause during rebalance.

**Cooperative Sticky (recommended):** only the partitions that need to move are revoked; others continue processing. Enable with:
```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

---

## Schema Registry

### Why schema registry is needed

Without it: consumers and producers are implicitly coupled by message format. A format change silently breaks consumers. With schema registry: schemas are versioned and compatibility is enforced at publish time.

### Confluent Schema Registry

Schemas are registered under a subject (default: `{topic}-value`, `{topic}-key`). Each schema version gets an ID. Messages include the schema ID in a 5-byte magic prefix; consumers look up the schema by ID.

**Compatibility modes:**

| Mode | Rule | Use When |
|------|------|----------|
| BACKWARD | New schema can read old data | Consumers deploy before producers |
| FORWARD | Old schema can read new data | Producers deploy before consumers |
| FULL | Both backward and forward | Zero-downtime rolling updates |
| NONE | No compatibility enforcement | Development only |

```bash
# Register schema
curl -X POST http://schema-registry:8081/subjects/orders-value/versions \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"schema": "{\"type\":\"record\",\"name\":\"Order\",\"fields\":[{\"name\":\"id\",\"type\":\"string\"},{\"name\":\"total\",\"type\":\"double\"}]}"}'

# Check compatibility before publishing a new version
curl -X POST http://schema-registry:8081/compatibility/subjects/orders-value/versions/latest \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"schema": "..."}'
```

---

## Topic Design

### Partition count guidelines

- Rule of thumb: start with 10-30 partitions per topic for most use cases
- Target throughput: `partitions = ceil(target_throughput / single_partition_throughput)` (single partition: ~50-100 MB/s for optimized producers)
- Consumer scaling: `partitions ≥ max_consumer_instances` in the consumer group
- Rebalance cost: more partitions = longer rebalance time; avoid > 1000 partitions per broker

### Increasing partition count

- Partition count can be increased but not decreased
- Increasing breaks hash-based key ordering: records for the same key may land in different partitions post-increase
- Solution: add partitions only during low-traffic periods; have consumers handle temporary ordering inconsistency

### Retention configuration

```properties
# Per-topic retention (override cluster defaults)
retention.ms=604800000          # 7 days
retention.bytes=53687091200     # 50 GB per partition

# Compacted topics (keep only latest value per key — useful for state snapshots)
cleanup.policy=compact
```

**Compacted topics:** Kafka periodically removes all but the most recent record per key. Useful for materializing the latest state (e.g., user profile, product catalog). Consumers still see all records during the compaction window.

---

## Kafka Streams

Kafka Streams is a client library for stream processing (filter, map, join, aggregate) with Kafka as both source and sink.

### Use cases

- Stateless transformation: filter, map, enrich event records
- Stateful aggregation: count orders per user in a tumbling window
- Join streams: enrich order events with customer data from a table (KTable from compacted topic)
- Exactly-once processing: Kafka Streams supports exactly-once semantics end-to-end

```java
StreamsBuilder builder = new StreamsBuilder();

KStream<String, Order> orders = builder.stream("orders");
KTable<String, Customer> customers = builder.table("customers");

orders
    .join(customers, (order, customer) -> new EnrichedOrder(order, customer))
    .filter((key, enrichedOrder) -> enrichedOrder.isHighValue())
    .to("high-value-orders");
```

---

## Monitoring and Alerting

### Key metrics (Prometheus via JMX exporter)

```yaml
# Consumer lag (most important metric)
kafka_consumer_group_lag{group, topic, partition}  # alert if > threshold

# Broker health
kafka_server_broker_topics_messages_in_per_sec
kafka_server_broker_bytes_in_per_sec
kafka_server_broker_bytes_out_per_sec
kafka_network_request_total_time_ms{quantile="0.99"}  # p99 request latency

# Producer metrics
kafka_producer_record_send_rate
kafka_producer_record_error_rate  # alert if > 0

# Replication
kafka_server_replica_manager_under_replicated_partitions  # alert if > 0; indicates broker issues
kafka_server_replica_manager_offline_partitions_count     # alert if > 0; data loss risk
```

### Consumer lag alerting

Consumer lag = number of messages the consumer is behind the producer. Lag growing = consumer cannot keep up.

```
Alert: consumer lag > (peak_message_rate * acceptable_delay_seconds)
  Example: 10,000 msg/s * 30s acceptable delay → alert if lag > 300,000 messages
```

Critical: if lag grows unboundedly, the consumer will never catch up unless processing speed > production speed.
