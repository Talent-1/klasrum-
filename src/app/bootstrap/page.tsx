"use client";

import { useState } from "react";

export default function BootstrapPage() {
  const [secret, setSecret] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setLoading(true);
    setMessage("");
    setSuccess(false);

    try {
      const response = await fetch("/api/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bootstrap-secret": secret,
        },
        body: JSON.stringify({
          fullName,
          email,
          password,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Setup failed.");
        return;
      }

      setSuccess(true);
      setMessage(result.message);

      setSecret("");
      setPassword("");
    } catch {
      setMessage("Unable to complete setup. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-5">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-sm border border-slate-200 p-6">

        <h1 className="text-2xl font-bold text-slate-900">
          Klasrum Setup
        </h1>

        <p className="text-sm text-slate-500 mt-2 mb-6">
          Create the first administrator for Bright Day Academy, Ogidi.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">

          <div>
            <label className="block text-sm font-medium mb-1">
              Bootstrap Secret
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              autoComplete="off"
              className="w-full border rounded-lg p-3"
              placeholder="Enter bootstrap secret"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Administrator's Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={100}
              className="w-full border rounded-lg p-3"
              placeholder="Enter full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Administrator's Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded-lg p-3"
              placeholder="Enter email address"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Administrator Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              className="w-full border rounded-lg p-3"
              placeholder="At least 12 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-700 text-white font-semibold rounded-lg p-3 disabled:opacity-50"
          >
            {loading ? "Creating administrator..." : "Create Administrator"}
          </button>

        </form>

        {message && (
          <div
            className={`mt-5 p-3 rounded-lg text-sm ${
              success
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}

        <p className="text-xs text-slate-400 mt-6">
          Restricted one-time setup. Do not share this page or its secret.
        </p>

      </div>
    </main>
  );
}