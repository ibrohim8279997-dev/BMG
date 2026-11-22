from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.utils import throttle

from . import service


class Ask(APIView):
    throttle_classes = [throttle('ai')]

    def post(self, request):
        q = str(request.data.get('question', '')).strip()
        if not q or len(q) > 2000:
            return Response({'error': 'invalid_request'}, status=400)
        role = 'seller' if request.user.role == 'seller' else 'client'
        lang = request.data.get('lang') if request.data.get('lang') in ('uz', 'ru', 'en') else request.user.language
        try:
            answer, disclaimer = service.ask(q, role, lang, user=request.user)
        except service.AIUnavailable:
            return Response({'error': 'ai_unavailable'}, status=503)
        return Response({'answer': answer, 'disclaimer': disclaimer})
