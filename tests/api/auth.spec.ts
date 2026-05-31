import { test, expect } from '../../fixtures';
import type { APIResponse } from '@playwright/test';

const VERIFY_LOGIN_ENDPOINT = '/api/verifyLogin';
const CREATE_ACCOUNT_ENDPOINT = '/api/createAccount';
const DELETE_ACCOUNT_ENDPOINT = '/api/deleteAccount';
const UPDATE_ACCOUNT_ENDPOINT = '/api/updateAccount';
const GET_USER_DETAIL_ENDPOINT = '/api/getUserDetailByEmail';

async function parseApiResponse(response: APIResponse): Promise<any> {
  expect(response.status()).toBe(200);
  return response.json();
}

// Shared test account created in beforeAll and deleted in afterAll
const sharedEmail = `api_test_${Date.now()}@example.com`;
const sharedPassword = 'TestPass123';

// Account used for api-12 delete lifecycle test
const deleteLifecycleEmail = `api_delete_${Date.now()}@example.com`;
const deleteLifecyclePassword = 'Test@1234';

// Account used for api-13 update lifecycle test
const updateLifecycleEmail = `api_update_${Date.now()}@example.com`;
const updateLifecyclePassword = 'Test@1234';

// Account used for api-14 get user detail test
const getUserEmail = `api_getuser_${Date.now()}@example.com`;
const getUserPassword = 'Test@1234';

// Account used for api-11-register-user-with-existing-email
const existingEmail = `api_existing_${Date.now()}@example.com`;
const existingPassword = 'Test@1234';

test.describe('Auth API', () => {

  // Create the shared account used by verifyLogin (valid login) and getUserDetail tests
  test.beforeAll(async ({ request }) => {
    // Shared account for verifyLogin valid test
    await request.post(CREATE_ACCOUNT_ENDPOINT, {
      form: {
        name: 'API Test User',
        email: sharedEmail,
        password: sharedPassword,
        title: 'Mr',
        birth_date: '1',
        birth_month: '1',
        birth_year: '2000',
        firstname: 'API',
        lastname: 'Test',
        company: 'QA Co',
        address1: '123 Main St',
        address2: '',
        country: 'United States',
        zipcode: '10001',
        state: 'New York',
        city: 'New York',
        mobile_number: '5551234567'
      }
    });

    // Account for delete lifecycle test (api-12)
    await request.post(CREATE_ACCOUNT_ENDPOINT, {
      form: {
        name: 'Delete Lifecycle User',
        email: deleteLifecycleEmail,
        password: deleteLifecyclePassword,
        title: 'Mr',
        birth_date: '10',
        birth_month: '7',
        birth_year: '1990',
        firstname: 'Delete',
        lastname: 'User',
        company: 'TestCo',
        address1: '123 Main St',
        address2: 'Apt 1',
        country: 'United States',
        zipcode: '10001',
        state: 'New York',
        city: 'New York',
        mobile_number: '5551234567'
      }
    });

    // Account for update lifecycle test (api-13)
    await request.post(CREATE_ACCOUNT_ENDPOINT, {
      form: {
        name: 'Update Lifecycle User',
        email: updateLifecycleEmail,
        password: updateLifecyclePassword,
        title: 'Mr',
        birth_date: '10',
        birth_month: '7',
        birth_year: '1990',
        firstname: 'Update',
        lastname: 'User',
        company: 'TestCo',
        address1: '123 Main St',
        address2: 'Apt 1',
        country: 'United States',
        zipcode: '10001',
        state: 'New York',
        city: 'New York',
        mobile_number: '5551234567'
      }
    });

    // Account for getUserDetailByEmail test (api-14)
    await request.post(CREATE_ACCOUNT_ENDPOINT, {
      form: {
        name: 'GetUser Test',
        email: getUserEmail,
        password: getUserPassword,
        title: 'Mrs',
        birth_date: '5',
        birth_month: '6',
        birth_year: '1995',
        firstname: 'GetUser',
        lastname: 'Test',
        company: 'DetailCo',
        address1: '789 Pine Rd',
        address2: 'Unit 3',
        country: 'Canada',
        zipcode: 'M5H 2N2',
        state: 'Ontario',
        city: 'Toronto',
        mobile_number: '4161234567'
      }
    });

    // Account for existing-email registration test (api-11-register-user-with-existing-email)
    await request.post(CREATE_ACCOUNT_ENDPOINT, {
      form: {
        name: 'Existing User',
        email: existingEmail,
        password: existingPassword,
        title: 'Mr',
        birth_date: '1',
        birth_month: '1',
        birth_year: '2000',
        firstname: 'Existing',
        lastname: 'User',
        company: 'ExistCo',
        address1: '1 Exist St',
        address2: '',
        country: 'United States',
        zipcode: '10001',
        state: 'New York',
        city: 'New York',
        mobile_number: '5551234567'
      }
    });
  });

  test.afterAll(async ({ request }) => {
    // Clean up shared account
    await request.delete(DELETE_ACCOUNT_ENDPOINT, {
      form: { email: sharedEmail, password: sharedPassword }
    });

    // Clean up update lifecycle account (delete lifecycle account is deleted in its own test)
    await request.delete(DELETE_ACCOUNT_ENDPOINT, {
      form: { email: updateLifecycleEmail, password: updateLifecyclePassword }
    });

    // Clean up getUserDetail account
    await request.delete(DELETE_ACCOUNT_ENDPOINT, {
      form: { email: getUserEmail, password: getUserPassword }
    });

    // Clean up existing-email account
    await request.delete(DELETE_ACCOUNT_ENDPOINT, {
      form: { email: existingEmail, password: existingPassword }
    });
  });

  // api-7-post-to-verify-login-with-valid-details
  test('should verify login with valid credentials', async ({ request }) => {
    const body = await parseApiResponse(
      await request.post(VERIFY_LOGIN_ENDPOINT, {
        form: {
          email: sharedEmail,
          password: sharedPassword
        }
      })
    );
    expect(body.responseCode).toBe(200);
    expect(body.message).toBe('User exists!');
  });

  // api-8-post-to-verify-login-without-email-parameter
  test('should return 400 when email parameter is missing from verifyLogin', async ({ request }) => {
    const body = await parseApiResponse(
      await request.post(VERIFY_LOGIN_ENDPOINT, {
        form: {
          password: 'Test@1234'
        }
      })
    );
    expect(body.responseCode).toBe(400);
    expect(body.message).toBe('Bad request, email or password parameter is missing in POST request.');
  });

  // api-9-delete-to-verify-login
  test('should return 405 when DELETE method is used on verifyLogin', async ({ request }) => {
    const body = await parseApiResponse(
      await request.delete(VERIFY_LOGIN_ENDPOINT)
    );
    expect(body.responseCode).toBe(405);
    expect(body.message).toBe('This request method is not supported.');
  });

  // api-10-post-to-verify-login-with-invalid-details
  test('should return 404 when verifyLogin is called with invalid credentials', async ({ request }) => {
    const body = await parseApiResponse(
      await request.post(VERIFY_LOGIN_ENDPOINT, {
        form: {
          email: 'nonexistent@test.com',
          password: 'WrongPass99'
        }
      })
    );
    expect(body.responseCode).toBe(404);
    expect(body.message).toBe('User not found!');
  });

  // api-11-post-to-create-register-user-account
  test('should create a new user account successfully', async ({ request }) => {
    const newUserEmail = `newuser_${Date.now()}@test.com`;
    const body = await parseApiResponse(
      await request.post(CREATE_ACCOUNT_ENDPOINT, {
        form: {
          name: 'Test User',
          email: newUserEmail,
          password: 'Test@1234',
          title: 'Mr',
          birth_date: '10',
          birth_month: '7',
          birth_year: '1990',
          firstname: 'Test',
          lastname: 'User',
          company: 'TestCo',
          address1: '123 Main St',
          address2: 'Apt 1',
          country: 'United States',
          zipcode: '10001',
          state: 'New York',
          city: 'New York',
          mobile_number: '5551234567'
        }
      })
    );
    expect(body.responseCode).toBe(201);
    expect(body.message).toBe('User created!');

    // Clean up the newly created account
    await request.delete(DELETE_ACCOUNT_ENDPOINT, {
      form: { email: newUserEmail, password: 'Test@1234' }
    });
  });

  // api-12-delete-method-to-delete-user-account
  test('should delete a user account and confirm deletion', async ({ request }) => {
    const deleteBody = await parseApiResponse(
      await request.delete(DELETE_ACCOUNT_ENDPOINT, {
        form: {
          email: deleteLifecycleEmail,
          password: deleteLifecyclePassword
        }
      })
    );
    expect(deleteBody.responseCode).toBe(200);
    expect(deleteBody.message).toBe('Account deleted!');

    // Confirm deletion by verifying login returns 404
    const verifyBody = await parseApiResponse(
      await request.post(VERIFY_LOGIN_ENDPOINT, {
        form: {
          email: deleteLifecycleEmail,
          password: deleteLifecyclePassword
        }
      })
    );
    expect(verifyBody.responseCode).toBe(404);
  });

  // api-13-put-method-to-update-user-account
  test('should update user account and verify the changes', async ({ request }) => {
    const updateBody = await parseApiResponse(
      await request.put(UPDATE_ACCOUNT_ENDPOINT, {
        form: {
          name: 'Updated User',
          email: updateLifecycleEmail,
          password: updateLifecyclePassword,
          title: 'Mrs',
          birth_date: '15',
          birth_month: '3',
          birth_year: '1985',
          firstname: 'Updated',
          lastname: 'User',
          company: 'NewCo',
          address1: '456 Oak Ave',
          address2: 'Suite 2',
          country: 'Canada',
          zipcode: 'M5H 2N2',
          state: 'Ontario',
          city: 'Toronto',
          mobile_number: '4161234567'
        }
      })
    );
    expect(updateBody.responseCode).toBe(200);
    expect(updateBody.message).toBe('User updated!');

    // Verify the update by fetching user detail and checking name
    const getUserBody = await parseApiResponse(
      await request.get(GET_USER_DETAIL_ENDPOINT, {
        params: { email: updateLifecycleEmail }
      })
    );
    expect(getUserBody.responseCode).toBe(200);
    expect(getUserBody.user.name).toBe('Updated User');
  });

  // api-14-get-user-account-detail-by-email
  test('should return user account detail by email', async ({ request }) => {
    const body = await parseApiResponse(
      await request.get(GET_USER_DETAIL_ENDPOINT, {
        params: { email: getUserEmail }
      })
    );
    expect(body.responseCode).toBe(200);

    const user = body.user;
    expect(user).toBeDefined();
    expect(typeof user.id).toBe('number');
    expect(typeof user.name).toBe('string');
    expect(typeof user.email).toBe('string');
    expect(typeof user.title).toBe('string');
    expect(user.birth_day).toBeDefined();
    expect(user.birth_month).toBeDefined();
    expect(user.birth_year).toBeDefined();
    expect(typeof user.first_name).toBe('string');
    expect(typeof user.last_name).toBe('string');
    expect(typeof user.company).toBe('string');
    expect(typeof user.address1).toBe('string');
    expect(typeof user.address2).toBe('string');
    expect(typeof user.country).toBe('string');
    expect(typeof user.state).toBe('string');
    expect(typeof user.city).toBe('string');
    expect(typeof user.zipcode).toBe('string');
    expect(user.email).toBe(getUserEmail);
  });

  // api-11-register-user-with-existing-email
  test('should return 400 when registering with an already existing email', async ({ request }) => {
    const body = await parseApiResponse(
      await request.post(CREATE_ACCOUNT_ENDPOINT, {
        form: {
          name: 'Duplicate User',
          email: existingEmail,
          password: existingPassword,
          title: 'Mr',
          birth_date: '1',
          birth_month: '1',
          birth_year: '2000',
          firstname: 'Duplicate',
          lastname: 'User',
          company: 'DupCo',
          address1: '1 Dup St',
          address2: '',
          country: 'United States',
          zipcode: '10001',
          state: 'New York',
          city: 'New York',
          mobile_number: '5551234567'
        }
      })
    );
    expect(body.responseCode).toBe(400);
    expect(body.message).toBe('Email already exists!');
  });

  // api-7-verify-login-missing-password-parameter
  test('should return 400 when password parameter is missing from verifyLogin', async ({ request }) => {
    const body = await parseApiResponse(
      await request.post(VERIFY_LOGIN_ENDPOINT, {
        form: {
          email: sharedEmail
        }
      })
    );
    expect(body.responseCode).toBe(400);
    expect(body.message).toBe('Bad request, email or password parameter is missing in POST request.');
  });

  // api-14-get-user-detail-missing-email-parameter
  test('should return 400 when email parameter is missing from getUserDetailByEmail', async ({ request }) => {
    const body = await parseApiResponse(
      await request.get(GET_USER_DETAIL_ENDPOINT)
    );
    expect(body.responseCode).toBe(400);
    expect(body.user).toBeUndefined();
  });

  // api-14-get-user-detail-nonexistent-email
  test('should return 404 when getUserDetailByEmail is called with a nonexistent email', async ({ request }) => {
    const ghostEmail = `ghost_${Date.now()}@nowhere.com`;
    const body = await parseApiResponse(
      await request.get(GET_USER_DETAIL_ENDPOINT, {
        params: { email: ghostEmail }
      })
    );
    expect(body.responseCode).toBe(404);
    expect(body.user).toBeUndefined();
  });

  // api-12-delete-account-invalid-credentials
  test('should return 404 when deleting account with invalid credentials', async ({ request }) => {
    const body = await parseApiResponse(
      await request.delete(DELETE_ACCOUNT_ENDPOINT, {
        form: {
          email: 'nonexistent@test.com',
          password: 'WrongPass'
        }
      })
    );
    expect(body.responseCode).toBe(404);
    expect(body.message).not.toBe('Account deleted!');
  });

  // api-13-update-account-nonexistent-user
  test('should return 404 when updating a nonexistent user account', async ({ request }) => {
    const ghostEmail = `ghost_${Date.now()}@nowhere.com`;
    const body = await parseApiResponse(
      await request.put(UPDATE_ACCOUNT_ENDPOINT, {
        form: {
          name: 'Ghost User',
          email: ghostEmail,
          password: 'Test@1234',
          title: 'Mr',
          birth_date: '1',
          birth_month: '1',
          birth_year: '2000',
          firstname: 'Ghost',
          lastname: 'User',
          company: 'GhostCo',
          address1: '0 Ghost Lane',
          address2: '',
          country: 'United States',
          zipcode: '00000',
          state: 'Nowhere',
          city: 'Nowhere',
          mobile_number: '0000000000'
        }
      })
    );
    expect(body.responseCode).toBe(404);
    expect(body.message).not.toBe('User updated!');
  });

});
