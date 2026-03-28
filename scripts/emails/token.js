async function getFirebaseToken() {
  const apiKey = "AIzaSyAOwCob-DvmU0R0nbyk12XlBLxirV1gXVs";
  const email = "diegobertosi@gmail.com";
  const password = "123123123";

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );

  const data = await res.json();
  console.log("ID Token:", data.idToken);
}

getFirebaseToken();