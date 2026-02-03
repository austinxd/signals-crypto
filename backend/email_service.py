"""
Email service using Resend for transactional emails.
"""
import os
import logging
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


# Logo as inline SVG data URI (works in most email clients)
LOGO_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%230f172a' width='100' height='100' rx='20'/%3E%3Ccircle cx='50' cy='50' r='8' fill='%2310b981'/%3E%3C/svg%3E"


def send_verification_email(to_email: str, code: str, lang: str = "es") -> bool:
    """
    Send email verification code to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

    if lang == "es":
        subject = f"{code} es tu codigo de verificacion"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <!-- Header with Logo -->
                    <tr>
                        <td style="padding:32px 40px; text-align:center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                            <img src="{LOGO_SVG}" alt="CRITERIO" width="50" height="50" style="display:block; margin:0 auto 16px auto; border-radius:12px;" />
                            <h1 style="margin:0; font-size:24px; font-weight:700; color:#ffffff; letter-spacing:3px;">CRITERIO</h1>
                            <p style="margin:8px 0 0 0; font-size:13px; color:#10b981;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding:32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Tu codigo de verificacion es:
                            </p>
                            <div style="background-color:#f0fdf4; border:2px solid #10b981; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:36px; font-weight:700; letter-spacing:8px; color:#0f172a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Ingresa este codigo en la app para verificar tu email.
                            </p>
                            <p style="margin:0; font-size:13px; color:#999;">
                                El codigo expira en 24 horas.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0 0 12px 0; font-size:12px; color:#999; text-align:center;">
                                Si no creaste una cuenta en CRITERIO, ignora este email.
                            </p>
                            <p style="margin:0; font-size:12px; color:#666; text-align:center;">
                                Desarrollado por <a href="https://instagram.com/austin.app" style="color:#10b981; text-decoration:none;">@austin.app</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Tu codigo de verificacion es: {code}

Ingresa este codigo en la app para verificar tu email.
El codigo expira en 24 horas.

Si no creaste una cuenta en CRITERIO, ignora este email.

Desarrollado por @austin.app (Instagram)
"""
    else:
        subject = f"{code} is your verification code"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <!-- Header with Logo -->
                    <tr>
                        <td style="padding:32px 40px; text-align:center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                            <img src="{LOGO_SVG}" alt="CRITERIO" width="50" height="50" style="display:block; margin:0 auto 16px auto; border-radius:12px;" />
                            <h1 style="margin:0; font-size:24px; font-weight:700; color:#ffffff; letter-spacing:3px;">CRITERIO</h1>
                            <p style="margin:8px 0 0 0; font-size:13px; color:#10b981;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding:32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Your verification code is:
                            </p>
                            <div style="background-color:#f0fdf4; border:2px solid #10b981; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:36px; font-weight:700; letter-spacing:8px; color:#0f172a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Enter this code in the app to verify your email.
                            </p>
                            <p style="margin:0; font-size:13px; color:#999;">
                                This code expires in 24 hours.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0 0 12px 0; font-size:12px; color:#999; text-align:center;">
                                If you didn't create a CRITERIO account, please ignore this email.
                            </p>
                            <p style="margin:0; font-size:12px; color:#666; text-align:center;">
                                Developed by <a href="https://instagram.com/austin.app" style="color:#10b981; text-decoration:none;">@austin.app</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Your verification code is: {code}

Enter this code in the app to verify your email.
This code expires in 24 hours.

If you didn't create a CRITERIO account, please ignore this email.

Developed by @austin.app (Instagram)
"""

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
            "text": text_content,
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
        subject = f"{code} - Restablecer contrasena"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <!-- Header with Logo -->
                    <tr>
                        <td style="padding:32px 40px; text-align:center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                            <img src="{LOGO_SVG}" alt="CRITERIO" width="50" height="50" style="display:block; margin:0 auto 16px auto; border-radius:12px;" />
                            <h1 style="margin:0; font-size:24px; font-weight:700; color:#ffffff; letter-spacing:3px;">CRITERIO</h1>
                            <p style="margin:8px 0 0 0; font-size:13px; color:#10b981;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding:32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Tu codigo para restablecer la contrasena es:
                            </p>
                            <div style="background-color:#fef3c7; border:2px solid #f59e0b; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:36px; font-weight:700; letter-spacing:8px; color:#0f172a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Ingresa este codigo en la app para crear una nueva contrasena.
                            </p>
                            <p style="margin:0; font-size:13px; color:#999;">
                                El codigo expira en 1 hora.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0 0 12px 0; font-size:12px; color:#999; text-align:center;">
                                Si no solicitaste restablecer tu contrasena, ignora este email.
                            </p>
                            <p style="margin:0; font-size:12px; color:#666; text-align:center;">
                                Desarrollado por <a href="https://instagram.com/austin.app" style="color:#10b981; text-decoration:none;">@austin.app</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Tu codigo para restablecer la contrasena es: {code}

Ingresa este codigo en la app para crear una nueva contrasena.
El codigo expira en 1 hora.

Si no solicitaste restablecer tu contrasena, ignora este email.

Desarrollado por @austin.app (Instagram)
"""
    else:
        subject = f"{code} - Reset your password"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <!-- Header with Logo -->
                    <tr>
                        <td style="padding:32px 40px; text-align:center; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                            <img src="{LOGO_SVG}" alt="CRITERIO" width="50" height="50" style="display:block; margin:0 auto 16px auto; border-radius:12px;" />
                            <h1 style="margin:0; font-size:24px; font-weight:700; color:#ffffff; letter-spacing:3px;">CRITERIO</h1>
                            <p style="margin:8px 0 0 0; font-size:13px; color:#10b981;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding:32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Your password reset code is:
                            </p>
                            <div style="background-color:#fef3c7; border:2px solid #f59e0b; border-radius:12px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:36px; font-weight:700; letter-spacing:8px; color:#0f172a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Enter this code in the app to create a new password.
                            </p>
                            <p style="margin:0; font-size:13px; color:#999;">
                                This code expires in 1 hour.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0 0 12px 0; font-size:12px; color:#999; text-align:center;">
                                If you didn't request a password reset, please ignore this email.
                            </p>
                            <p style="margin:0; font-size:12px; color:#666; text-align:center;">
                                Developed by <a href="https://instagram.com/austin.app" style="color:#10b981; text-decoration:none;">@austin.app</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Your password reset code is: {code}

Enter this code in the app to create a new password.
This code expires in 1 hour.

If you didn't request a password reset, please ignore this email.

Developed by @austin.app (Instagram)
"""

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
            "text": text_content,
        }
        response = resend.Emails.send(params)
        logger.info(f"Password reset email sent to {to_email}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send password reset email to {to_email}: {e}")
        return False
