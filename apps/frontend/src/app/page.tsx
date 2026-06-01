'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, TrendingUp, FileText, Shield, Zap, Activity } from 'lucide-react';
import { api } from '../lib/api';

interface Stats {
  totalCases: number;
  unacknowledgedAlerts: number;
  totalOverrides: number;
  newBizLeads: number;
}

interface AtRiskCase {
  id: string;
  ep_number: string;
  status: string;
  risk_tier: string;
  risk_score: number;
  validation_deadline: string;
  applicant_name: string;
  pathway: string;
  target_states: string[];
}

interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  recommended_action: string;
  route_to: string;
  acknowledgment_sla_hours: number;
  case_id?: string;
  created_at: string;
  acknowledged_at?: string;
}

const riskBadge = (tier: string) => {
  const map: Record<string, string> = {
    CRITICAL: 'badge-critical',
    HIGH: 'badge-high',
    MEDIUM: 'badge-medium',
    LOW: 'badge-low',
  };
  return map[tier] || 'badge-low';
};

const daysUntil = (date: string) => {
  const diff = new Date(date).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskCase[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '';

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, atRiskRes, alertsRes] = await Promise.all([
          api.admin.stats(token),
          api.cases.atRisk(14),
          api.alerts.list({ acknowledged: 'false', limit: 20 }),
        ]);
        setStats(statsRes.data);
        setAtRisk(atRiskRes.data.cases || []);
        setAlerts(alertsRes.data.alerts || []);
      } catch (e) {
        console.error('Failed to load dashboard:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleAcknowledge = async (alertId: string) => {
    setAcknowledging(alertId);
    try {
      await api.alerts.acknowledge(alertId, { decision: 'Acknowledged via dashboard', notes: '' }, token);
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (e) {
      console.error('Failed to acknowledge:', e);
    } finally {
      setAcknowledging(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Activity className="h-12 w-12 text-blue-600 animate-pulse mx-auto" />
          <p className="mt-3 text-gray-600 font-medium">Loading IP Centrum platform…</p>
        </div>
      </div>
    );
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL');
  const highAlerts = alerts.filter(a => a.severity === 'HIGH');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-lg font-bold text-gray-900">IP Centrum</h1>
                <p className="text-xs text-gray-500">Agentic AI Platform</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {criticalAlerts.length > 0 && (
                <span className="flex items-center gap-1.5 badge-critical px-3 py-1 text-sm animate-pulse">
                  <AlertTriangle className="h-4 w-4" />
                  {criticalAlerts.length} CRITICAL
                </span>
              )}
              <nav className="flex gap-6 text-sm font-medium text-gray-600">
                <a href="#" className="text-blue-600 border-b-2 border-blue-600 pb-0.5">Dashboard</a>
                <a href="#cases" className="hover:text-gray-900">Cases</a>
                <a href="#alerts" className="hover:text-gray-900">Alerts</a>
                <a href="#agents" className="hover:text-gray-900">Agents</a>
                <a href="#regulatory" className="hover:text-gray-900">Regulatory</a>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Critical banner */}
        {criticalAlerts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-800">{criticalAlerts.length} critical alert{criticalAlerts.length > 1 ? 's' : ''} require immediate action</p>
              <p className="text-red-700 text-sm mt-0.5">{criticalAlerts.map(a => a.title).join(' · ')}</p>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Cases', value: stats?.totalCases ?? '—', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Unacknowledged Alerts', value: stats?.unacknowledgedAlerts ?? '—', icon: AlertTriangle, color: alerts.length > 0 ? 'text-red-600' : 'text-green-600', bg: alerts.length > 0 ? 'bg-red-50' : 'bg-green-50' },
            { label: 'AI Overrides (Total)', value: stats?.totalOverrides ?? '—', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
            { label: 'New BizSignal Leads', value: stats?.newBizLeads ?? '—', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="card">
              <div className="card-body flex items-center gap-4">
                <div className={`p-3 rounded-lg ${bg}`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* At-Risk Cases */}
          <div className="card" id="cases">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-orange-500" />
                Cases Due Within 14 Days
              </h2>
              <span className="text-xs text-gray-500">{atRisk.length} cases</span>
            </div>
            <div className="divide-y divide-gray-100">
              {atRisk.length === 0 ? (
                <div className="card-body text-center py-8">
                  <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No cases at risk within 14 days</p>
                </div>
              ) : (
                atRisk.map(c => {
                  const days = daysUntil(c.validation_deadline);
                  return (
                    <div key={c.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-gray-900">{c.ep_number}</span>
                            <span className={riskBadge(c.risk_tier)}>{c.risk_tier}</span>
                            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{c.pathway}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 truncate">{c.applicant_name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{c.target_states?.length} states · {c.status.replace(/_/g, ' ')}</p>
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <p className={`text-lg font-bold ${days <= 7 ? 'text-red-600' : days <= 14 ? 'text-orange-500' : 'text-amber-500'}`}>{days}d</p>
                          <p className="text-xs text-gray-400">remaining</p>
                        </div>
                      </div>
                      {/* Risk score bar */}
                      <div className="mt-2">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${c.risk_score >= 85 ? 'bg-red-500' : c.risk_score >= 70 ? 'bg-orange-500' : c.risk_score >= 50 ? 'bg-amber-400' : 'bg-green-400'}`}
                            style={{ width: `${c.risk_score}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">Risk score: {c.risk_score}/100</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Alerts */}
          <div className="card" id="alerts">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Unacknowledged Alerts
              </h2>
              <span className="text-xs text-gray-500">{alerts.length} open</span>
            </div>
            <div className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="card-body text-center py-8">
                  <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">All alerts acknowledged</p>
                </div>
              ) : (
                alerts.map(alert => (
                  <div key={alert.id} className={`px-6 py-4 ${alert.severity === 'CRITICAL' ? 'bg-red-50' : alert.severity === 'HIGH' ? 'bg-orange-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={riskBadge(alert.severity)}>{alert.severity}</span>
                          <span className="text-xs text-gray-400">{alert.route_to.replace(/_/g, ' ')}</span>
                          <span className="text-xs text-gray-400">SLA: {alert.acknowledgment_sla_hours}h</span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 mt-1 leading-tight">{alert.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{alert.recommended_action}</p>
                      </div>
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        disabled={acknowledging === alert.id}
                        className="btn-secondary text-xs px-3 py-1.5 shrink-0"
                      >
                        {acknowledging === alert.id ? '…' : 'Acknowledge'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Agent Status Grid */}
        <div id="agents">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-blue-600" />
            Agent Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { id: 'DocIntel', phase: 1, desc: 'Patent document analysis', icon: '📄' },
              { id: 'DataVerify', phase: 1, desc: 'Data quality gateway', icon: '✅' },
              { id: 'CaseHealth', phase: 1, desc: 'Real-time risk monitor', icon: '🏥' },
              { id: 'RegWatch', phase: 1, desc: 'Regulatory intelligence', icon: '📡' },
              { id: 'TransOrch', phase: 2, desc: 'Translation orchestration', icon: '🌐' },
              { id: 'ClientComms', phase: 2, desc: 'Client communication', icon: '📧' },
              { id: 'QuoteAdvisor', phase: 2, desc: 'Quote optimisation', icon: '💡' },
              { id: 'AgentNet', phase: 3, desc: 'National agent network', icon: '🗺️' },
              { id: 'RenewIntel', phase: 3, desc: 'Renewals intelligence', icon: '🔄' },
              { id: 'BizSignal', phase: 4, desc: 'Business development', icon: '📊' },
            ].map(agent => (
              <div key={agent.id} className="card hover:shadow-md transition-shadow">
                <div className="p-4 text-center">
                  <div className="text-2xl mb-2">{agent.icon}</div>
                  <p className="text-sm font-semibold text-gray-900">{agent.id}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-tight">{agent.desc}</p>
                  <div className="mt-3 flex items-center justify-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs text-green-600 font-medium">Active</span>
                  </div>
                  <span className="mt-1 inline-block text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Phase {agent.phase}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-gray-400 py-4 border-t border-gray-200">
          IP Centrum Agentic AI Platform · All agent decisions are logged with full audit trails · 7-year retention
        </footer>
      </main>
    </div>
  );
}
