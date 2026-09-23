"use client";

export default function PrivacyPage() {
  return (
    <main className="privacyPage">
      <div className="card privacyCard">
        <span className="live">UPI BILLS</span>
        <h1>Privacy Policy</h1>
        <p>UPI Bills uses the information you provide to create your account, authenticate you, create bills, and provide bill-sharing and history features.</p>
        <h2>Information we collect</h2>
        <p>Account information may include your name, UPI ID, email address, optional mobile number, and password. Passwords are stored as a secure hash rather than plain text.</p>
        <h2>How we use it</h2>
        <p>Your information is used to operate account, billing, payment-link, sharing, and history features. Your UPI ID is used when generating a UPI payment link.</p>
        <h2>Your choice</h2>
        <p>Mobile number is optional. You can choose not to provide it when creating an account.</p>
        <h2>Contact</h2>
        <p>If you have a privacy question about this application, contact the application owner through the project support channel.</p>
        <button className="primary" onClick={() => window.history.back()}>Back</button>
      </div>
    </main>
  );
}
