// Teamdev snapshots only. No credentials, network implementation or workflow transitions.
function rdvText(value, limit = 256) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";
}

// Upstream only guarantees phones[]; entries may be strings or objects. First recognizable number wins, else "".
function rdvPhone(phones) {
  for (const entry of Array.isArray(phones) ? phones : []) {
    const value = typeof entry === "string" ? entry : (entry && typeof entry === "object" ? entry.number : "");
    const text = rdvText(typeof value === "number" && Number.isFinite(value) ? String(value) : value);
    if (text) return text;
  }
  return "";
}

function normalizeTeamdevAppointment(value) {
  const raw = value && typeof value === "object" ? value : {};
  const intervention = raw.intervention || {};
  const service = intervention.service || {};
  const vehicle = intervention.vehicle || {};
  const client = vehicle.client || {};
  return {
    rdvIntegration: normalizeRdvIntegration({
      provider: "teamdev-rdv", interventionId: intervention.id, appointmentId: raw.id,
      vehicleId: vehicle.id || intervention.vehicleId, clientId: vehicle.clientId || client.id,
      serviceId: service.id || intervention.serviceId, abstractServiceId: service.abstractServiceId || service.abstractService?.id,
      agencyId: service.agencyId, brandId: service.brandId, appointmentDate: raw.date,
      appointmentStatus: raw.status, interventionStatus: intervention.status,
      requestedDate: intervention.requestedDate, upstreamUpdatedAt: raw.updatedAt,
    }),
    clientName: [rdvText(client.firstName), rdvText(client.lastName)].filter(Boolean).join(" "),
    phone: rdvPhone(client.phones),
    vin: rdvText(vehicle.chassisNumber), plate: rdvText(vehicle.registrationNumber),
    vehicle: rdvText(vehicle.name || [vehicle.brandName, vehicle.version?.model?.title, vehicle.version?.version].filter(v => typeof v === "string").join(" ")),
    mileage: (typeof intervention.km === "number" || typeof intervention.km === "string") && String(intervention.km).trim() && Number.isFinite(Number(intervention.km)) && Number(intervention.km) >= 0 ? String(Number(intervention.km)) : "",
    visitReason: rdvText(intervention.description, 2000),
  };
}

function normalizeTeamdevAppointments(payload) {
  return (Array.isArray(payload?.result) ? payload.result : []).map(normalizeTeamdevAppointment)
    .filter(row => row.rdvIntegration.appointmentId && row.rdvIntegration.interventionId);
}

function matchRdvCase(row, cases) {
  const refs = row.rdvIntegration || {};
  const list = (cases || []).filter(item => !item.deletedAt);
  for (const key of ["interventionId", "appointmentId"]) {
    if (!refs[key]) continue;
    const matches = list.filter(item => item.rdvIntegration?.provider === "teamdev-rdv" && item.rdvIntegration[key] === refs[key]);
    if (matches.length) return { item: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1, by: key };
  }
  const token = value => rdvText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const same = (a, b) => Boolean(token(a)) && token(a) === token(b);
  const matches = list.filter(item => {
    if (item.flags?.delivered || item.flags?.invoiced || item.closedAt || item.archivedAt || ["closed", "archived"].includes(item.status) || item.rdvIntegration?.interventionId || item.rdvIntegration?.appointmentId) return false;
    if (token(row.vin) && token(item.vin) && !same(row.vin, item.vin)) return false;
    if (token(row.plate) && token(item.plate) && !same(row.plate, item.plate)) return false;
    const vehicle = (token(row.vin).length >= 8 && same(row.vin, item.vin)) || (token(row.plate).length >= 5 && same(row.plate, item.plate));
    const client = (token(row.phone).length >= 8 && same(row.phone, item.phone)) || (refs.clientId && refs.clientId === item.rdvIntegration?.clientId);
    return vehicle && client;
  });
  return { item: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1, by: matches.length ? "identity" : "" };
}

function isRdvCanceled(row) {
  return /^(cancelled|canceled|annul[eé]e?)$/i.test(row.rdvIntegration?.appointmentStatus || "");
}

function isRdvLate(row, now = new Date(), thresholdMinutes = 15) {
  const date = Date.parse(row.rdvIntegration?.appointmentDate || "");
  return !isRdvCanceled(row) && Number.isFinite(date) && Number.isFinite(thresholdMinutes)
    && thresholdMinutes >= 0 && new Date(now).getTime() > date + thresholdMinutes * 60000;
}

function hydrateRdvCase(item, row) {
  const result = { ...item, rdvIntegration: normalizeRdvIntegration(row.rdvIntegration) };
  const empty = value => value == null || (typeof value === "string" && !value.trim());
  for (const key of ["clientName", "phone", "vehicle", "vin", "plate"]) {
    if (empty(item[key]) && row[key]) result[key] = row[key];
  }
  const received = item.flags?.received || item.receptionWorkflow?.vehicleReceivedAt || item.receptionWorkflow?.vehicleMileageEntry;
  if (!received) {
    for (const key of ["mileage", "visitReason"]) {
      if (empty(item[key]) && !(key === "visitReason" && item.arrivalNotes) && row[key]) result[key] = row[key];
    }
  }
  return result;
}

// A future authorized proxy may be supplied by the host. The browser has no default transport.
async function loadRdvAppointments(transport, params = {}) {
  if (typeof transport !== "function") return { enabled: false, rows: [] };
  const payload = await transport(params);
  return { enabled: true, rows: normalizeTeamdevAppointments(payload) };
}
