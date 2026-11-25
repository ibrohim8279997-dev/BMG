import django.utils.timezone
from django.db import migrations, models

from apps.orders.models import new_external_id


def fill(apps, schema_editor):
    Order = apps.get_model('orders', 'Order')
    for o in Order.objects.all().only('id', 'created_at').iterator():
        Order.objects.filter(pk=o.pk).update(external_id=new_external_id(), updated_at=o.created_at)


class Migration(migrations.Migration):
    dependencies = [('orders', '0002_order_buyer_inn_order_buyer_name_order_buyer_type')]

    operations = [
        migrations.AddField('order', 'external_id', models.CharField(max_length=40, null=True, editable=False)),
        migrations.AddField('order', 'version', models.PositiveIntegerField(default=0)),
        migrations.AddField('order', 'updated_at', models.DateTimeField(default=django.utils.timezone.now, db_index=True)),
        migrations.AddField('order', 'paid_at', models.DateTimeField(null=True, blank=True)),
        migrations.AddField('order', 'completed_at', models.DateTimeField(null=True, blank=True)),
        migrations.AddField('order', 'cancelled_at', models.DateTimeField(null=True, blank=True)),
        migrations.AddField('order', 'cancel_reason', models.CharField(max_length=40, blank=True)),
        migrations.RunPython(fill, migrations.RunPython.noop),
        migrations.AlterField('order', 'external_id', models.CharField(
            max_length=40, unique=True, default=new_external_id, editable=False)),
    ]
