const ApiError = require("../utils/ApiError");

// Wraps a Zod schema into Express middleware. Validates whichever parts of
// the request the schema defines (body/params/query) and replaces
// req[part] with the *parsed* value — so downstream code gets
// coerced/defaulted values (e.g. a query string "5" becomes the number 5
// if the schema says z.coerce.number()), not just a validity check.
//
// Usage:
//   router.post("/", validate({ body: registerUserSchema }), registerUser);
//
// On failure, throws a single ApiError(400) whose `errors` array lists
// every field problem at once (not just the first) — the existing
// errorHandler middleware already knows how to render `errors: []`.
const validate = (schemas) => (req, res, next) => {
  for (const part of ["body", "params", "query"]) {
    const schema = schemas[part];
    if (!schema) continue;

    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      return next(new ApiError(400, messages[0] || "Validation failed", messages));
    }

    req[part] = result.data;
  }
  next();
};

module.exports = validate;
