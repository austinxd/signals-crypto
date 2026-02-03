"""
Email service using Resend for transactional emails.
"""
import os
import logging
import secrets
import random
import resend

logger = logging.getLogger("uvicorn.error")

# Configure Resend
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FROM_EMAIL = "CRITERIO <noreply@criterio.trade>"

resend.api_key = RESEND_API_KEY


def generate_verification_code() -> str:
    """Generate a 6-digit verification code."""
    return str(random.randint(100000, 999999))


def send_verification_email(to_email: str, code: str, lang: str = "es") -> bool:
    """
    Send email verification code to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

    if lang == "es":
        subject = "Tu codigo de verificacion - CRITERIO"
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
                .code-box {{ background: #0f172a; border: 2px solid #10b981; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0; }}
                .code {{ font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #10b981; font-family: monospace; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
                .warning {{ color: #f59e0b; font-size: 13px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Tu codigo de verificacion</h1>
                <p>Ingresa este codigo en la app para verificar tu email:</p>
                <div class="code-box">
                    <div class="code">{code}</div>
                </div>
                <p class="warning">Este codigo expira en 24 horas. No compartas este codigo con nadie.</p>
                <div class="footer">
                    <p>Si no creaste esta cuenta, puedes ignorar este email.</p>
                    <p>CRITERIO - Crypto Trading Intelligence</p>
                </div>
            </div>
        </body>
        </html>
        """
    else:
        subject = "Your verification code - CRITERIO"
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
                .code-box {{ background: #0f172a; border: 2px solid #10b981; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0; }}
                .code {{ font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #10b981; font-family: monospace; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
                .warning {{ color: #f59e0b; font-size: 13px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Your verification code</h1>
                <p>Enter this code in the app to verify your email:</p>
                <div class="code-box">
                    <div class="code">{code}</div>
                </div>
                <p class="warning">This code expires in 24 hours. Do not share this code with anyone.</p>
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


def send_password_reset_email(to_email: str, code: str, lang: str = "es") -> bool:
    """
    Send password reset code to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

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
                .code-box {{ background: #0f172a; border: 2px solid #10b981; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0; }}
                .code {{ font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #10b981; font-family: monospace; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
                .warning {{ color: #f59e0b; font-size: 13px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Restablecer contrasena</h1>
                <p>Ingresa este codigo en la app para restablecer tu contrasena:</p>
                <div class="code-box">
                    <div class="code">{code}</div>
                </div>
                <p class="warning">Este codigo expira en 1 hora. No compartas este codigo con nadie.</p>
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
                .code-box {{ background: #0f172a; border: 2px solid #10b981; border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0; }}
                .code {{ font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #10b981; font-family: monospace; }}
                .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }}
                .warning {{ color: #f59e0b; font-size: 13px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">CRITERIO<span class="dot"></span></div>
                <h1>Reset your password</h1>
                <p>Enter this code in the app to reset your password:</p>
                <div class="code-box">
                    <div class="code">{code}</div>
                </div>
                <p class="warning">This code expires in 1 hour. Do not share this code with anyone.</p>
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
