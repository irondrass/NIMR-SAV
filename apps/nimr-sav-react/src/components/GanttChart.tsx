import React from 'react';
import { WorkshopResource } from '../domain/resource-manager';
import { PlanningBooking } from '../domain/collision-engine';
import { buildGanttRows, calculateGanttItemPosition } from '../domain/gantt-planning';

interface GanttChartProps {
  resources: WorkshopResource[];
  bookings: PlanningBooking[];
  viewDate: Date;
  onSelectBooking?: (bookingId: string) => void;
}

export const GanttChart: React.FC<GanttChartProps> = ({
  resources,
  bookings,
  viewDate,
  onSelectBooking,
}) => {
  const startHour = 8;
  const endHour = 17;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

  const rows = buildGanttRows(resources, bookings, viewDate);

  return (
    <div className="gantt-container" style={{
      background: 'var(--card-bg, #ffffff)',
      border: '1px solid var(--border-color, #e2e8f0)',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      overflowX: 'auto',
    }}>
      <div className="gantt-header-info" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main, #1e293b)' }}>
          Planning Journalier - {viewDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </h3>
        <div style={{ display: 'flex', gap: '15px', fontSize: '0.85rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }}></span>
            Normal
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444', animation: 'pulse 2s infinite' }}></span>
            Collision / Conflit
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: '#e2e8f0', backgroundImage: 'repeating-linear-gradient(45deg, #cbd5e1 0px, #cbd5e1 2px, transparent 2px, transparent 8px)' }}></span>
            Absence / Congé
          </span>
        </div>
      </div>

      <div style={{ minWidth: '800px' }}>
        {/* Time Headers */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px' }}>
          <div style={{ width: '220px', flexShrink: 0, fontWeight: 600, fontSize: '0.85rem', color: '#64748b' }}>
            Ressource / Poste
          </div>
          <div style={{ display: 'flex', flexGrow: 1, position: 'relative' }}>
            {hours.map((hour) => (
              <div key={hour} style={{
                flex: 1,
                textAlign: 'left',
                fontSize: '0.8rem',
                color: '#64748b',
                fontWeight: 500,
                borderLeft: '1px dashed #cbd5e1',
                paddingLeft: '4px',
              }}>
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {rows.map((row) => (
            <div key={row.resourceId} style={{
              display: 'flex',
              alignItems: 'center',
              background: '#f8fafc',
              borderRadius: '8px',
              minHeight: '52px',
              padding: '4px 0',
              border: '1px solid #f1f5f9',
            }}>
              {/* Resource Cell */}
              <div style={{ width: '220px', flexShrink: 0, paddingLeft: '10px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155' }}>
                  {row.resourceLabel}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    background: '#e2e8f0',
                    color: '#475569',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontWeight: 500,
                  }}>
                    {row.resourceType}
                  </span>
                  {row.loadPercentage > 0 && !row.onLeave && (
                    <span style={{
                      fontSize: '0.7rem',
                      color: row.loadPercentage > 100 ? '#ef4444' : row.loadPercentage > 80 ? '#f97316' : '#10b981',
                      fontWeight: 600,
                    }}>
                      Charge : {row.loadPercentage}%
                    </span>
                  )}
                </div>
              </div>

              {/* Timeline Cell */}
              <div style={{ display: 'flex', flexGrow: 1, height: '40px', position: 'relative', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                {/* Background hour grid lines */}
                {hours.map((_, idx) => (
                  <div key={idx} style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${(idx / (hours.length - 1)) * 100}%`,
                    borderLeft: '1px solid #f1f5f9',
                    zIndex: 1,
                  }} />
                ))}

                {/* Content */}
                {row.onLeave ? (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'repeating-linear-gradient(45deg, #f1f5f9 0px, #f1f5f9 6px, #e2e8f0 6px, #e2e8f0 12px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    zIndex: 2,
                  }}>
                    Congé / Absence
                  </div>
                ) : (
                  row.items.map((item) => {
                    const pos = calculateGanttItemPosition(item.start, item.end, startHour, endHour);
                    return (
                      <div
                        key={item.id}
                        onClick={() => onSelectBooking?.(item.bookingId)}
                        title={`${item.label} (${item.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} - ${item.end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`}
                        style={{
                          position: 'absolute',
                          top: '6px',
                          bottom: '6px',
                          left: pos.left,
                          width: pos.width,
                          background: item.collision ? '#fee2e2' : '#dbeafe',
                          border: item.collision ? '2px solid #ef4444' : '1px solid #3b82f6',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 8px',
                          cursor: onSelectBooking ? 'pointer' : 'default',
                          zIndex: 3,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                          transition: 'all 0.2s',
                        }}
                        className={item.collision ? 'gantt-item-collision' : ''}
                      >
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: item.collision ? '#991b1b' : '#1d4ed8',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {item.collision ? `⚠️ Collision : ${item.label}` : item.label}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .5; }
        }
        .gantt-item-collision {
          animation: borderPulse 1.5s infinite;
        }
        @keyframes borderPulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
};
