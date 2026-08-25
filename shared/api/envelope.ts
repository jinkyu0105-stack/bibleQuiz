export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  requestId: string;
  field?: string;
}

export interface ApiFailure {
  error: ApiErrorDetail;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function success<T>(data: T): ApiSuccess<T> {
  return { data };
}

export function failure(error: ApiErrorDetail): ApiFailure {
  return { error };
}
