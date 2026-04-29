import { http, HttpResponse } from "msw";
import { MULTIPART_THRESHOLD } from "../../src/config.js";

const BASE = "https://controlfile.test";
const B2 = "https://b2.example.com";

interface PresignBody {
  name: string;
  size: number;
  mime: string;
  parentId?: string;
}

export const baseUrl = BASE;

export const handlers = [
  http.post(`${BASE}/v1/uploads/presign`, async ({ request }) => {
    const body = (await request.json()) as PresignBody;
    if (!body || typeof body.size !== "number") {
      return HttpResponse.json({ error: "Bad body" }, { status: 400 });
    }
    if (body.size >= MULTIPART_THRESHOLD) {
      const parts = Array.from({ length: 4 }, (_, i) => ({
        partNumber: i + 1,
        url: `${B2}/multipart/sess-mp/part/${i + 1}?sig=abc`,
      }));
      return HttpResponse.json({
        uploadSessionId: "sess-mp",
        multipart: { uploadId: "u-1", parts },
      });
    }
    return HttpResponse.json({
      uploadSessionId: "sess-1",
      url: `${B2}/upload?sig=abc`,
      uploadUrl: `${B2}/upload?sig=abc`,
      method: "PUT",
      headers: {},
      proxyUpload: {
        method: "POST",
        path: "/v1/uploads/proxy-upload",
        contentType: "multipart/form-data",
        fileField: "file",
        sessionIdField: "sessionId",
      },
    });
  }),

  http.put(`${B2}/upload`, () => {
    return new HttpResponse(null, {
      status: 200,
      headers: { etag: '"etag-simple"' },
    });
  }),

  http.put(`${B2}/multipart/:session/part/:n`, ({ params }) => {
    return new HttpResponse(null, {
      status: 200,
      headers: { etag: `"etag-${params.n}"` },
    });
  }),

  http.post(`${BASE}/v1/uploads/proxy-upload`, async () => {
    return HttpResponse.json({ success: true, etag: "etag-proxy" });
  }),

  http.post(`${BASE}/v1/uploads/confirm`, async () => {
    return HttpResponse.json({
      success: true,
      fileId: "file-confirmed",
      message: "Upload confirmed",
    });
  }),

  http.get(`${BASE}/v1/files/list`, () => {
    return HttpResponse.json({
      items: [
        {
          id: "f1",
          type: "file",
          userId: "u1",
          name: "doc.pdf",
          size: 1024,
          mime: "application/pdf",
          bucketKey: "u1/2026/doc.pdf",
          parentId: null,
          path: "/doc.pdf",
          ancestors: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      nextPage: null,
    });
  }),

  http.post(`${BASE}/v1/files/presign-get`, () => {
    return HttpResponse.json({
      downloadUrl: `${B2}/download?sig=zzz`,
      fileName: "doc.pdf",
      fileSize: 1024,
    });
  }),

  http.post(`${BASE}/v1/shares/create`, async ({ request }) => {
    const body = (await request.json()) as { fileId: string };
    return HttpResponse.json({
      shareToken: "tok-abc",
      shareUrl: `${BASE}/share/tok-abc`,
      expiresAt: "2030-01-01T00:00:00.000Z",
      fileName: `file-${body.fileId}`,
    });
  }),

  http.get(`${BASE}/v1/shares/tok-expired`, () => {
    return HttpResponse.json(
      { error: "Share expired", code: "SHARE_EXPIRED" },
      { status: 410 },
    );
  }),

  http.get(`${BASE}/v1/shares/tok-good`, () => {
    return HttpResponse.json({
      fileName: "doc.pdf",
      fileSize: 1024,
      mime: "application/pdf",
      expiresAt: null,
      downloadCount: 3,
    });
  }),
];

let auth401Counter = 0;
export function reset401(): void {
  auth401Counter = 0;
}

export const auth401Handlers = [
  http.get(`${BASE}/v1/users/profile`, ({ request }) => {
    auth401Counter += 1;
    if (auth401Counter === 1) {
      return HttpResponse.json(
        { error: "Token expirado", code: "AUTH_TOKEN_EXPIRED" },
        { status: 401 },
      );
    }
    const auth = request.headers.get("authorization") ?? "";
    return HttpResponse.json({
      uid: "u1",
      email: "u@example.com",
      displayName: "U",
      planId: "free",
      planQuotaBytes: 1000,
      usedBytes: 100,
      pendingBytes: 0,
      _seenAuth: auth,
    });
  }),
];
