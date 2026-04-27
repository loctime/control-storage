declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type IsoDateTime = Brand<string, "IsoDateTime">;
export type BucketKey = Brand<string, "BucketKey">;

export type FileId = string;
export type FolderId = string;
export type UploadSessionId = string;
export type ShareToken = string;
