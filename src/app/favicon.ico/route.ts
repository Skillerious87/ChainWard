export function GET(request: Request): Response {
  return Response.redirect(new URL("/icon.svg", request.url), 308);
}
