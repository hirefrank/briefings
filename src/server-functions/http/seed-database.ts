import { seedDatabase } from '../../scripts/seed.js';
// Env type is globally defined

export default async function seedDatabaseEndpoint(env: Env): Promise<Response> {
  try {
    // Use the seed function
    await seedDatabase(env);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Database seeded with example feeds',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Seeding error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
