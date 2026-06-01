import axios, { AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export function createApiClient(token?: string): AxiosInstance {
  return axios.create({
    baseURL: `${API_URL}/api/v1`,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 30000,
  });
}

// Typed API helpers
export const api = {
  cases: {
    list: (params?: Record<string, string | number>) =>
      createApiClient().get('/cases', { params }),
    get: (id: string) => createApiClient().get(`/cases/${id}`),
    create: (data: Record<string, unknown>, token: string) =>
      createApiClient(token).post('/cases', data),
    atRisk: (days = 14) =>
      createApiClient().get('/cases/dashboard/at-risk', { params: { days } }),
    risk: (id: string, token: string) =>
      createApiClient(token).get(`/cases/${id}/risk`),
    releaseQuarantine: (id: string, justification: string, token: string) =>
      createApiClient(token).post(`/cases/${id}/release-quarantine`, { justification }),
  },
  alerts: {
    list: (params?: Record<string, string | number>) =>
      createApiClient().get('/alerts', { params }),
    acknowledge: (id: string, data: Record<string, unknown>, token: string) =>
      createApiClient(token).post(`/alerts/${id}/acknowledge`, data),
    slaBreaches: (token: string) =>
      createApiClient(token).get('/alerts/sla-breaches'),
  },
  agents: {
    runDocIntel: (epNumber: string, token: string) =>
      createApiClient(token).post('/agents/doc-intel', { epNumber }),
    runQuoteAdvisor: (data: Record<string, unknown>, token: string) =>
      createApiClient(token).post('/agents/quote-advisor', data),
    overrideStats: (token: string) =>
      createApiClient(token).get('/agents/override-stats'),
    bizSignalScan: (token: string) =>
      createApiClient(token).post('/agents/biz-signal/scan'),
    regWatchScan: (token: string) =>
      createApiClient(token).post('/agents/reg-watch/scan'),
  },
  regulatory: {
    changes: (params?: Record<string, string>) =>
      createApiClient().get('/regulatory/changes', { params }),
    approve: (id: string, token: string) =>
      createApiClient(token).post(`/regulatory/changes/${id}/approve`),
    reject: (id: string, token: string) =>
      createApiClient(token).post(`/regulatory/changes/${id}/reject`),
  },
  admin: {
    stats: (token: string) => createApiClient(token).get('/admin/stats'),
    auditLog: (token: string, params?: Record<string, number>) =>
      createApiClient(token).get('/admin/audit-log', { params }),
    bizLeads: (token: string) => createApiClient(token).get('/admin/biz-leads'),
  },
  health: {
    check: () => axios.get(`${API_URL}/health`),
  },
};
