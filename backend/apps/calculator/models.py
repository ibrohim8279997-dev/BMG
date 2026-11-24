from django.conf import settings
from django.db import models


class ObjectRequest(models.Model):
    class Type(models.TextChoices):
        APARTMENT = 'apartment', 'Apartment'
        HOUSE = 'house', 'House'
        COMPLEX = 'complex', 'Residential complex'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='objects_requested')
    type = models.CharField(max_length=10, choices=Type.choices)
    area = models.DecimalField(max_digits=10, decimal_places=2)
    floors = models.PositiveSmallIntegerField(default=1)
    rooms = models.PositiveSmallIntegerField(default=1)
    city = models.CharField(max_length=80)
    # Optional building geometry from the 3D designer (m / degrees). When absent the rough area-based rules apply.
    length = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    width = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    floor_height = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    roof_type = models.CharField(max_length=8, blank=True, default='')
    roof_pitch = models.PositiveSmallIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ConsumptionNorm(models.Model):
    """Approximate material consumption per m2 of a zone. Produced by AI (+web search),
    cached, and editable/reviewable by staff. Never presented as exact."""
    object_type = models.CharField(max_length=10)
    zone = models.CharField(max_length=10)
    category = models.ForeignKey('catalog.Category', on_delete=models.CASCADE)
    per_m2 = models.DecimalField(max_digits=10, decimal_places=4)
    unit = models.CharField(max_length=20, blank=True)
    note = models.CharField(max_length=300, blank=True)
    source = models.CharField(max_length=10, default='ai')      # ai | demo | staff
    reviewed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('object_type', 'zone', 'category')]
