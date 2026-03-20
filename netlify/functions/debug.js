exports.handler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
      hasOneSignalApp: !!process.env.ONESIGNAL_APP_ID,
      hasOneSignalKey: !!process.env.ONESIGNAL_API_KEY,
      hasGmail: !!process.env.GMAIL_USER,
      nodeVersion: process.version
    })
  };
};
