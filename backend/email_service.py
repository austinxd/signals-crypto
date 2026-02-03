"""
Email service using Resend for transactional emails.
"""
import os
import logging
import secrets
import resend

logger = logging.getLogger("uvicorn.error")

# Configure Resend
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FROM_EMAIL = "CRITERIO <noreply@criterio.trade>"
BASE_URL = os.getenv("BASE_URL", "https://api.criterio.trade")

resend.api_key = RESEND_API_KEY


def generate_verification_token() -> str:
    """Generate a secure random token for email verification."""
    return secrets.token_urlsafe(32)


def send_verification_email(to_email: str, token: str, lang: str = "es") -> bool:
    """
    Send email verification link to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

    verification_url = f"{BASE_URL}/api/auth/verify-email?token={token}"

    if lang == "es":
        subject = "Verifica tu email - CRITERIO"
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; }}
                .container {{ max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 40px; }}
                .logo {{ font-size: 28px; font-weight: bold; letter-spacing: 4px; margin-bottom: 30px; }}
                .dot {{ display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-left: 4px; }}
                h1 {{ font-size: 24px; margin-bottom: 20px; color: #fff; }}
                p {{ color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }}
                .button {{ display: inline-block; background: #10b981; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }}
                .button:hover {{ background: #059669; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
                .link {{ color: #10b981; word-break: break-all; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Verifica tu email</h1>
                <p>Gracias por registrarte en CRITERIO. Para completar tu registro y acceder a todas las funciones, verifica tu email haciendo clic en el boton:</p>
                <a href="{verification_url}" class="button">Verificar Email</a>
                <p>O copia y pega este enlace en tu navegador:</p>
                <p class="link">{verification_url}</p>
                <p>Este enlace expira en 24 horas.</p>
                <div class="footer">
                    <p>Si no creaste esta cuenta, puedes ignorar este email.</p>
                    <p>CRITERIO - Crypto Trading Intelligence</p>
                </div>
            </div>
        </body>
        </html>
        """
    else:
        subject = "Verify your email - CRITERIO"
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; }}
                .container {{ max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 40px; }}
                .logo {{ font-size: 28px; font-weight: bold; letter-spacing: 4px; margin-bottom: 30px; }}
                .dot {{ display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-left: 4px; }}
                h1 {{ font-size: 24px; margin-bottom: 20px; color: #fff; }}
                p {{ color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }}
                .button {{ display: inline-block; background: #10b981; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }}
                .button:hover {{ background: #059669; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
                .link {{ color: #10b981; word-break: break-all; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Verify your email</h1>
                <p>Thanks for signing up for CRITERIO. To complete your registration and access all features, please verify your email by clicking the button below:</p>
                <a href="{verification_url}" class="button">Verify Email</a>
                <p>Or copy and paste this link in your browser:</p>
                <p class="link">{verification_url}</p>
                <p>This link expires in 24 hours.</p>
                <div class="footer">
                    <p>If you didn't create this account, you can ignore this email.</p>
                    <p>CRITERIO - Crypto Trading Intelligence</p>
                </div>
            </div>
        </body>
        </html>
        """

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }
        response = resend.Emails.send(params)
        logger.info(f"Verification email sent to {to_email}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send verification email to {to_email}: {e}")
        return False


def send_password_reset_email(to_email: str, token: str, lang: str = "es") -> bool:
    """
    Send password reset link to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

    reset_url = f"{BASE_URL}/api/auth/reset-password?token={token}"

    if lang == "es":
        subject = "Restablecer contrasena - CRITERIO"
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; }}
                .container {{ max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 40px; }}
                .logo {{ font-size: 28px; font-weight: bold; letter-spacing: 4px; margin-bottom: 30px; }}
                .dot {{ display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-left: 4px; }}
                h1 {{ font-size: 24px; margin-bottom: 20px; color: #fff; }}
                p {{ color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }}
                .button {{ display: inline-block; background: #10b981; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Restablecer contrasena</h1>
                <p>Recibimos una solicitud para restablecer la contrasena de tu cuenta CRITERIO.</p>
                <a href="{reset_url}" class="button">Restablecer Contrasena</a>
                <p>Este enlace expira en 1 hora.</p>
                <div class="footer">
                    <p>Si no solicitaste esto, puedes ignorar este email.</p>
                    <p>CRITERIO - Crypto Trading Intelligence</p>
                </div>
            </div>
        </body>
        </html>
        """
    else:
        subject = "Reset your password - CRITERIO"
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; }}
                .container {{ max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 40px; }}
                .logo {{ font-size: 28px; font-weight: bold; letter-spacing: 4px; margin-bottom: 30px; }}
                .dot {{ display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-left: 4px; }}
                h1 {{ font-size: 24px; margin-bottom: 20px; color: #fff; }}
                p {{ color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }}
                .button {{ display: inline-block; background: #10b981; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 20px 0; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Reset your password</h1>
                <p>We received a request to reset the password for your CRITERIO account.</p>
                <a href="{reset_url}" class="button">Reset Password</a>
                <p>This link expires in 1 hour.</p>
                <div class="footer">
                    <p>If you didn't request this, you can ignore this email.</p>
                    <p>CRITERIO - Crypto Trading Intelligence</p>
                </div>
            </div>
        </body>
        </html>
        """

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }
        response = resend.Emails.send(params)
        logger.info(f"Password reset email sent to {to_email}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send password reset email to {to_email}: {e}")
        return False
