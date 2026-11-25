// Fill these in from your Supabase project: the Project URL, and the Publishable key (Project Settings → API Keys).
// The publishable key is meant to be public: each student can only read and change their own row,
// because of the row-level security rules in supabase/schema.sql.
// Left empty, the site runs in demo mode and keeps data only in this browser.
window.USUL_CONFIG = {
  supabaseUrl: 'https://sjlrkpuproeukiaqbfmh.supabase.co',
  supabaseAnonKey: 'sb_publishable_-Km9KMooh5mJOnysF550Xw__tampRjJ',
  // Turn on after setting up the Azure (Microsoft) provider in Supabase → Authentication → Providers.
  microsoftSignIn: false,
};
