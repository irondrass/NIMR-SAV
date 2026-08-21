const STATUS_CYCLE = [
  ["chief_validation", 0.10],
  ["planning", 0.15],
  ["in_progress", 0.25],
  ["completed", 0.20],
  ["closed", 0.20],
  ["archived", 0.10],
];

function seededRandom(seed = 0x9e3779b9) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function statusForIndex(index) {
  const fraction = (index % 100) / 100;
  let cumulative = 0;
  for (const [status, ratio] of STATUS_CYCLE) {
    cumulative += ratio;
    if (fraction < cumulative) return status;
  }
  return "archived";
}

function isoDay(dayOffset) {
  return new Date(Date.UTC(2025, 5, 1 + (dayOffset % 28), 9, 0, 0)).toISOString();
}

export function buildDataset(caseCount, options = {}) {
  const bookingPerCase = Number(options.bookingPerCase || 3);
  const seed = Number(options.seed || 0x006005);
  const random = seededRandom(seed);
  const cases = new Array(caseCount);
  const bookings = new Array(caseCount * bookingPerCase);
  const resources = ["mecanicien-1", "tolier-1", "peintre-1", "controle-1"].map((id, index) => ({
    id,
    name: `Ressource benchmark ${index + 1}`,
    role: ["mecanicien", "tolier", "peintre", "controle"][index],
    active: true,
    capacity: 1,
  }));
  const users = [{ id: "benchmark-admin", name: "Benchmark Admin", role: "admin_technique", active: true }];

  for (let index = 0; index < caseCount; index += 1) {
    const id = `case-${String(index).padStart(7, "0")}`;
    const status = statusForIndex(index);
    const createdAt = isoDay(index % 365);
    cases[index] = {
      id,
      clientName: `Client benchmark ${index}`,
      phone: `+216700${String(index % 100000).padStart(5, "0")}`,
      vehicle: index % 2 ? "Berline benchmark" : "SUV benchmark",
      vin: `VINBENCH${String(index).padStart(9, "0")}`,
      plate: `BENCH-${String(index).padStart(6, "0")}`,
      orNavNumber: `OR-BENCH-${String(index).padStart(7, "0")}`,
      status,
      createdAt,
      updatedAt: isoDay((index + 1) % 365),
      flags: {
        received: index % 3 !== 0,
        workCompleted: ["completed", "closed", "archived"].includes(status),
        invoiced: ["closed", "archived"].includes(status),
        delivered: status === "archived",
      },
      durations: { body: 1.5, prep: 1, paint: 2, reassembly: 1 },
      receptionWorkflow: {
        currentStep: status === "chief_validation" ? 1 : 10,
        qualityStatus: index % 11 === 0 ? "approved" : "not_started",
        qualityReviewHistory: [],
      },
      claims: index % 17 === 0 ? [{ id: `claim-${index}`, status: "open", title: "Benchmark claim", createdAt, updatedAt: createdAt }] : [],
      history: [{ id: `history-${index}`, type: "benchmark.created", at: createdAt, user: "Benchmark" }],
      appointment: index % 4 === 0 ? { start: isoDay((index + 2) % 365), end: isoDay((index + 2) % 365) } : null,
    };

    for (let offset = 0; offset < bookingPerCase; offset += 1) {
      const bookingIndex = index * bookingPerCase + offset;
      const resourceId = resources[(index + offset) % resources.length].id;
      const start = isoDay((index + offset) % 365);
      bookings[bookingIndex] = {
        id: `booking-${String(bookingIndex).padStart(8, "0")}`,
        caseId: id,
        key: ["body", "prep", "paint", "quality"][offset % 4],
        title: `Benchmark task ${bookingIndex}`,
        resourceIds: [resourceId],
        start,
        end: new Date(new Date(start).getTime() + (30 + Math.floor(random() * 90)) * 60000).toISOString(),
        plannedStart: start,
        plannedMinutes: 60,
        status: offset === 0 && index % 13 === 0 ? "started" : "planned",
        segments: [{ start, end: new Date(new Date(start).getTime() + (30 + Math.floor(random() * 90)) * 60000).toISOString() }],
        temporary: false,
      };
    }
  }

  return {
    schemaVersion: 23,
    dataSchemaVersion: 23,
    currentUserId: "benchmark-admin",
    users,
    resources,
    cases,
    bookings,
    auditLog: [],
    syncLog: [],
    syncConflicts: [],
    outbox: [],
    ui: { caseStatusFilter: "all", caseTypeFilter: "all", caseSort: "recent" },
  };
}

export const DATASET_STATUS_RATIOS = Object.fromEntries(STATUS_CYCLE);
