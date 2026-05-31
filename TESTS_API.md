# Test Cases

**Total: 19 tests**

---

## tests/api/products.spec.ts

### Products API

| # | Test |
|---|------|
| 1 | should return products list |
| 2 | should return method not supported for POST to products list |
| 3 | should return brands list |
| 4 | should return method not supported for PUT to brands list |
| 5 | should return bad request for missing search_product parameter |
| 6 | should return no matching products for non-existent search term |

---

## tests/api/auth.spec.ts

### Auth API

| # | Test |
|---|------|
| 1 | should verify login with valid credentials |
| 2 | should return 400 when email parameter is missing from verifyLogin |
| 3 | should return 405 when DELETE method is used on verifyLogin |
| 4 | should return 404 when verifyLogin is called with invalid credentials |
| 5 | should create a new user account successfully |
| 6 | should delete a user account and confirm deletion |
| 7 | should update user account and verify the changes |
| 8 | should return user account detail by email |
| 9 | should return 400 when password parameter is missing from verifyLogin |
| 10 | should return 400 when email parameter is missing from getUserDetailByEmail |
| 11 | should return 404 when getUserDetailByEmail is called with a nonexistent email |
| 12 | should return 404 when deleting account with invalid credentials |
| 13 | should return 404 when updating a nonexistent user account |

---

## ❌ Broken Tests

> Fix manually or run: `npm run fix -- --pattern <spec>`

| Spec | Describe | Test | Root cause |
|------|----------|------|------------|
| tests/api/products.spec.ts | Products API | should return products matching search term | Failed on first run — run `npm run fix` to investigate |
| tests/api/auth.spec.ts | Auth API | should return 400 when registering with an already existing email | Failed on first run — run `npm run fix` to investigate |
