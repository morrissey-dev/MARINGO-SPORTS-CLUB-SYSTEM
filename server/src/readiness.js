// Kept separate from Express/database dependencies so status behavior is unit-testable.
export async function readinessResult(checkDatabase) {
  try {
    await checkDatabase();
    return {statusCode:200, body:{status:'ready'}};
  } catch {
    // Do NOT return connection strings, stack traces, server addresses or errors.
    return {statusCode:503, body:{status:'not_ready'}};
  }
}
