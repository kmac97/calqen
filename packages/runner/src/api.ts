export interface RunnerToken {
  runnerId: string
  runnerToken: string
}

export function createApi(token: RunnerToken, apiBase: string) {
  const { runnerId, runnerToken } = token

  function call(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${runnerToken}`,
        'X-Runner-ID': runnerId,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    return fetch(`${apiBase}${path}`, init)
  }

  return {
    poll: () => call('GET', '/api/runner/poll'),

    heartbeat: (leaseId: string) =>
      call('POST', '/api/runner/heartbeat', { runnerId, leaseId }),

    progress: (taskId: string, leaseId: string, stage: string, message?: string) =>
      call('POST', `/api/runner/tasks/${taskId}/progress`, { leaseId, stage, message }),

    deletionDetected: (taskId: string, leaseId: string, files: string[], diffContent: string) =>
      call('POST', `/api/runner/tasks/${taskId}/deletion-detected`, { leaseId, files, diffContent }),

    complete: (taskId: string, leaseId: string, params: {
      diffSummary: string
      filesChanged: string[]
      filesCreated: string[]
      filesModified: string[]
      filesDeleted: string[]
      testOutput: string
      passed: boolean
    }) => call('POST', `/api/runner/tasks/${taskId}/complete`, { leaseId, ...params }),

    fail: (taskId: string, leaseId: string, reason: string, stage?: string) =>
      call('POST', `/api/runner/tasks/${taskId}/fail`, { leaseId, reason, stage }),
  }
}
