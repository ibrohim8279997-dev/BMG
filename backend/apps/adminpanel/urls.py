from django.urls import path

from . import views as v

urlpatterns = [
    path('login', v.AdminLogin.as_view()),
    path('logout', v.AdminLogout.as_view()),
    path('me', v.AdminMe.as_view()),
    path('sellers', v.Sellers.as_view()),
    path('sellers/<int:pk>', v.SellerDetail.as_view()),
    path('sellers/<int:pk>/phone', v.SellerPhone.as_view()),
    path('commission-levels', v.Levels.as_view()),
    path('roles', v.Roles.as_view()),
    path('staff', v.StaffUsers.as_view()),
    path('complaints', v.Complaints.as_view()),
    path('complaints/<int:pk>', v.ComplaintDetail.as_view()),
    path('audit', v.Audit.as_view()),
    path('settings', v.Settings.as_view()),
    path('orders', v.AdminOrders.as_view()),
    path('orders/<int:pk>/refund', v.AdminRefund.as_view()),
    path('payouts', v.Payouts.as_view()),
    path('payouts/<int:pk>', v.Payouts.as_view()),
    path('ai-usage', v.AIUsageView.as_view()),
    path('legal', v.Legal.as_view()),
    path('categories', v.AdminCategories.as_view()),
    path('norms', v.AdminNorms.as_view()),
]
