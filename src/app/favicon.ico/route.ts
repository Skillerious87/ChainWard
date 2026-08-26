export function GET(request: Request): Response {
  return Response.redirect(new URL("/icons/favicon.ico", request.url), 308);
}
